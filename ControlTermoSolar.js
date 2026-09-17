// Control de resistencia de calentador y electroválvula de circuito solar térmico.
// Dispositivo: Shelly Plus 2PM + Shelly Addon Plus (3x DS18B20 + entrada digital).
//
// Asunciones acordadas (ver Claude.md para el resto de la especificación):
// - La "entrada digital 0" de verificación de la electroválvula es el input:0
//   nativo del Plus 2PM (asociado al canal switch 0), configurado en modo
//   "detached" para poder leerse como sensor sin accionar el switch.
// - Si falta o no puede leerse un valor KVS necesario para una lógica, esa
//   salida se fuerza a apagada ese ciclo (comportamiento fail-safe).
// - MsgError se recalcula cada ciclo y se vacía cuando no hay errores activos.
// - Límite de KVS (Gen2): valor máx. 253 caracteres.

let SENSOR_CALENTADOR_ID = 100; // temperature:100 - sensor "Calentador"
let SENSOR_SUPERIOR_ID   = 101; // temperature:101 - sensor "Sonda Superior"
let SENSOR_SOLAR_ID      = 102; // temperature:102 - sensor "Solar Termica"

let SWITCH_ELECTROVALVULA_ID = 0; // switch:0 - salida "Electrovalvula"
let SWITCH_RESISTENCIA_ID    = 1; // switch:1 - salida "Resistencia"
let INPUT_ELECTROVALVULA_ID  = 0; // input:0 - feedback digital de la electroválvula

let TEMPERATURA_CONSIGNA_KVS  = "TemperaturaConsignaTermo";
let RESISTENCIA_ENABLE_KVS    = "ResistenciaHabilitada";
let ELECTROVALVULA_ENABLE_KVS = "ElectrovalvulaHabilitada";
let HISTERESIS_SOLAR_ON_KVS   = "HisteresisSolarON";
let HISTERESIS_SOLAR_OFF_KVS  = "HisteresisSolarOFF";
let HISTERESIS_TERMO_KVS      = "HisteresisTermo";
let MSG_ERROR_KVS             = "MsgError";

let POLL_MS = 5000;
let ELECTROVALVULA_FEEDBACK_TIMEOUT_MS = 10000;
let KVS_VALUE_MAX_LEN = 253; // límite de Shelly Gen2 para valores KVS

let electrovalvulaOnSinceMs = null; // uptime (ms) desde que se mandó ON la electroválvula
let lastMsgError = null; // último valor escrito en MsgError, para no reescribir KVS sin necesidad

function toNumber(v) {
  if (v === undefined || v === null) return null;
  let n = Number(v);
  if (isNaN(n)) return null;
  return n;
}

function readTemperature(sensorId) {
  let status = Shelly.getComponentStatus("temperature:" + sensorId);
  if (status === null || typeof status.tC !== "number") return null;
  return status.tC;
}

function setSwitchIfNeeded(name, switchId, desiredOn, currentOn) {
  if (desiredOn === currentOn) return;
  print("ControlTermoSolar: " + name + " (switch:" + switchId + ") " + (currentOn ? "ON" : "OFF") + " -> " + (desiredOn ? "ON" : "OFF"));
  Shelly.call("Switch.Set", { id: switchId, on: desiredOn }, function (result, error_code, error_message) {
    if (error_code !== 0) {
      print("ControlTermoSolar: error al accionar switch " + switchId + ": " + error_message);
    }
  });
}

function updateMsgError(errors) {
  let msg = errors.join(",");
  if (msg.length > KVS_VALUE_MAX_LEN) {
    msg = msg.slice(0, KVS_VALUE_MAX_LEN);
  }
  if (msg === lastMsgError) return;
  lastMsgError = msg;
  print("ControlTermoSolar: " + MSG_ERROR_KVS + " <- \"" + msg + "\"");
  Shelly.call("KVS.Set", { key: MSG_ERROR_KVS, value: msg }, function (result, error_code, error_message) {
    if (error_code !== 0) {
      print("ControlTermoSolar: error al escribir " + MSG_ERROR_KVS + ": " + error_message);
    }
  });
}

function runCycle(kvsItems, kvsReadFailed) {
  let errors = [];

  // --- Lectura y validación de parámetros KVS ---
  let neededKeys = [
    RESISTENCIA_ENABLE_KVS,
    TEMPERATURA_CONSIGNA_KVS,
    HISTERESIS_TERMO_KVS,
    ELECTROVALVULA_ENABLE_KVS,
    HISTERESIS_SOLAR_ON_KVS,
    HISTERESIS_SOLAR_OFF_KVS
  ];
  let kvs = {};
  for (let i = 0; i < neededKeys.length; i++) {
    let key = neededKeys[i];
    let value = kvsReadFailed ? null : toNumber(kvsItems[key]);
    if (value === null) {
      errors.push("ErrKVS." + key);
    }
    kvs[key] = value;
  }

  let resistenciaEnabled = kvs[RESISTENCIA_ENABLE_KVS] === 1;
  let electrovalvulaEnabled = kvs[ELECTROVALVULA_ENABLE_KVS] === 1;

  print("ControlTermoSolar: KVS -> " + RESISTENCIA_ENABLE_KVS + "=" + kvs[RESISTENCIA_ENABLE_KVS] +
    " " + TEMPERATURA_CONSIGNA_KVS + "=" + kvs[TEMPERATURA_CONSIGNA_KVS] +
    " " + HISTERESIS_TERMO_KVS + "=" + kvs[HISTERESIS_TERMO_KVS] +
    " " + ELECTROVALVULA_ENABLE_KVS + "=" + kvs[ELECTROVALVULA_ENABLE_KVS] +
    " " + HISTERESIS_SOLAR_ON_KVS + "=" + kvs[HISTERESIS_SOLAR_ON_KVS] +
    " " + HISTERESIS_SOLAR_OFF_KVS + "=" + kvs[HISTERESIS_SOLAR_OFF_KVS]);

  // --- Lectura de sensores y estado actual ---
  let calentadorTemp = readTemperature(SENSOR_CALENTADOR_ID);
  let superiorTemp = readTemperature(SENSOR_SUPERIOR_ID);
  let solarTemp = readTemperature(SENSOR_SOLAR_ID);

  let switchResistenciaStatus = Shelly.getComponentStatus("switch:" + SWITCH_RESISTENCIA_ID);
  let switchElectrovalvulaStatus = Shelly.getComponentStatus("switch:" + SWITCH_ELECTROVALVULA_ID);
  let currentResistenciaOn = switchResistenciaStatus !== null && switchResistenciaStatus.output === true;
  let currentElectrovalvulaOn = switchElectrovalvulaStatus !== null && switchElectrovalvulaStatus.output === true;

  let inputStatus = Shelly.getComponentStatus("input:" + INPUT_ELECTROVALVULA_ID);
  let electrovalvulaFeedbackOn = inputStatus !== null && inputStatus.state === true;

  print("ControlTermoSolar: sensores -> Calentador=" + calentadorTemp + "C Superior=" + superiorTemp +
    "C Solar=" + solarTemp + "C InputValvula=" + electrovalvulaFeedbackOn);
  print("ControlTermoSolar: estado actual -> Resistencia=" + (currentResistenciaOn ? "ON" : "OFF") +
    " Electrovalvula=" + (currentElectrovalvulaOn ? "ON" : "OFF"));

  // --- Lógica de la resistencia del calentador ---
  let desiredResistencia = currentResistenciaOn;
  if (calentadorTemp === null) {
    errors.push("ErrSondaCalentador");
    desiredResistencia = false;
  } else if (!resistenciaEnabled) {
    desiredResistencia = false;
  } else {
    let consigna = kvs[TEMPERATURA_CONSIGNA_KVS];
    let histTermo = kvs[HISTERESIS_TERMO_KVS];
    if (consigna !== null && histTermo !== null) {
      if (calentadorTemp < (consigna - histTermo)) {
        desiredResistencia = true;
      } else if (calentadorTemp >= consigna) {
        desiredResistencia = false;
      }
    } else {
      desiredResistencia = false;
    }
  }

  // --- Lógica de la electroválvula solar ---
  let desiredElectrovalvula = currentElectrovalvulaOn;
  if (superiorTemp === null) {
    errors.push("ErrSondaSuperior");
    desiredElectrovalvula = false;
  } else if (solarTemp === null) {
    errors.push("ErrSondaSolar");
    desiredElectrovalvula = false;
  } else if (!electrovalvulaEnabled) {
    desiredElectrovalvula = false;
  } else {
    let histOn = kvs[HISTERESIS_SOLAR_ON_KVS];
    let histOff = kvs[HISTERESIS_SOLAR_OFF_KVS];
    if (histOn !== null && histOff !== null) {
      if (superiorTemp < (solarTemp - histOn)) {
        desiredElectrovalvula = true;
      } else if (superiorTemp >= (solarTemp - histOff)) {
        desiredElectrovalvula = false;
      }
    } else {
      desiredElectrovalvula = false;
    }
  }

  // --- Verificación de feedback de la electroválvula (entrada digital 0) ---
  let nowMs = Shelly.getUptimeMs();
  if (desiredElectrovalvula) {
    if (electrovalvulaOnSinceMs === null) {
      electrovalvulaOnSinceMs = nowMs;
    } else if ((nowMs - electrovalvulaOnSinceMs) >= ELECTROVALVULA_FEEDBACK_TIMEOUT_MS && !electrovalvulaFeedbackOn) {
      errors.push("ErrReleElec");
      desiredElectrovalvula = false;
      electrovalvulaOnSinceMs = null;
    }
  } else {
    electrovalvulaOnSinceMs = null;
  }

  print("ControlTermoSolar: decision -> Resistencia=" + (desiredResistencia ? "ON" : "OFF") +
    " Electrovalvula=" + (desiredElectrovalvula ? "ON" : "OFF"));
  if (errors.length > 0) {
    print("ControlTermoSolar: errores -> " + errors.join(","));
  }

  // --- Aplicar salidas ---
  setSwitchIfNeeded("Resistencia", SWITCH_RESISTENCIA_ID, desiredResistencia, currentResistenciaOn);
  setSwitchIfNeeded("Electrovalvula", SWITCH_ELECTROVALVULA_ID, desiredElectrovalvula, currentElectrovalvulaOn);

  // --- Reportar errores ---
  updateMsgError(errors);
}

function mainLoop() {
  Shelly.call("KVS.GetMany", { match: "*" }, function (result, error_code, error_message) {
    if (error_code !== 0) {
      print("ControlTermoSolar: error al leer KVS: " + error_message);
      runCycle({}, true);
      return;
    }
    // KVS.GetMany devuelve result.items como ARRAY de {key, etag, value},
    // no como objeto {clave: valor}; hay que reconstruirlo aquí.
    let rawItems = (result && result.items) ? result.items : [];
    print("ControlTermoSolar: KVS.GetMany -> " + rawItems.length + " elemento(s), total=" + (result ? result.total : "?"));
    let items = {};
    for (let i = 0; i < rawItems.length; i++) {
      let entry = rawItems[i];
      print("ControlTermoSolar: KVS raw -> " + entry.key + "=" + entry.value);
      items[entry.key] = entry.value;
    }
    runCycle(items, false);
  });
}

Timer.set(POLL_MS, true, mainLoop);
mainLoop();
