# Control solar térmico

El proyecto trata de controlar la resistencia un calentador y una electroválvula que hace circular el circuito del intercambiador de calor procedente de una instalación solar térmica.
Se dispone de un Shelly Plus 2PM conectado aun Shelly Addons Plus, al cual se conectan tres sensores de temperatura DS1820 y una entrada digital procedente de la electroválvula (a modo de seguridad pare verificar que la electroválvula funciona).
Los sensores son:

- Una sonda dentro del calentador en la parte inferior (sensor "Calentador")
- Una sonda dentro calentador en la parte superior externa del calentador (sensor "Sonda Superior")
- Una sonda en el tubo del fluido caloportador procedente de la instalación termosolar
- Un sersor digital para saber si la electoválvula está activada o no (pulsador del swith 0)

Lo que se desea es poder controlar independientemente la resistencia del calentador y la electroválvula mediante un script de Shelly cargado en el dispotivo de control.

## Resietencia calentador

La resistencia del calentador debe activarse o desactivarse según:

- Si está habilitado el circuito de la resistencia (KVS ResistenciaHabilitada) puede entrar en funcionamiento. Si no, no debe hacerse funcionar.
- Si la temperatura del calentador (sensor Calentador) desciende por debajo de la temperatura de consiga (KVS TemperaturaConsignaTermo) menos la de histéresis definida (KVS HisteresisTermo), al resistencia debe activar.
- Si la temperatura de calentador (sensor Calentador) alcanza la temperatura de consigna (KVS TemperaturaConsignaTermo), la resistencia del calentador debe apagarse.

## Electroválvula del solar solar térmica

La electroválvula del calentador debe funcionar de la siguiente manera:

- Si está habilitado el circuito de la solar (KVS ElectrovalvulaHabilitada) puede entrar en funcionamiento. Si no, no debe hacerse funcionar.
- Si la temperatura superior del termo (sensor Sonda Superior) desciende  por debajo de la temperatura del sensor de la solar (sensor Solar Termica) menos la de histéresis de bajada (KVS HisteresisSolarON) debe activarse la electroválvula.
- Si la temperatura superior del termo (sensor Sonda Superior) alcanza la temperatura del sensor de la solar (sensor Solar Termica) menos la histéresis de subida (KVS HisteresisSolarOFF), entonces debe desactivarse la electroválvula.

## Información adicional

El ciclo de ejecución debe ser el 5 segundos, de menera que se comprueben todas las condicones al menos una vez cada 5 segundos.

## Condiciones de error

Si no se pueden leer los valores de la sonda Calentador, la resistencia del calentador (salida Resistencia) no debe activarse y debe alertase del error mediante mensaje en KVS MsgError: ErrSondaCalentador.
Si no se pueden leer los valores de la sonda Superior o Solar Termica, la electroválvula (salida Electrovalvula) no debe activarse y debe alertase del error exacto mediante mensaje en KVS MsgError: ErrSondaSuperior, ErrSondaSolar.
Si tras 10 segundos de activar la electroválvula, la entrada nativa 0 no está activa, debe comportarse como error de solar termica, desactivando la electroválvula y monstrando el mensaje de error: ErrReleElec.
Si no puedieran leerse los valores de KVS, debe alertase de ello en la variable KVS MsgError mediante el texto (ErrKVS.NOMBRE_VARIABLE_KVS).
Los errores inrán separados por "," con el máximo permitido en ese tipo de variables.

## Datos adicionales

Nombre definidos a usarse en el programa:

```script
let SENSOR1_ID   = 100;          // ID del sensor "Calentador". Siglas SSC
let SENSOR2_ID   = 101;          // ID del sensor "Sonda Superior". Siglas SSS
let SENSOR3_ID   = 102;          // ID del sensor "Solar Termica"
let SWITCH_ID    = 0;            // Salida "Electrovalvula"
let SWITCH_ID    = 1;            // Salida "Resistencia"

let TEMPERATURA_CONSIGNA_KVS = "TemperaturaConsignaTermo";   // Nombre KVS para el valor de temperatura a la que se desea que esté el el agua del termo. Valor numerico 09.9
let RESISTENCIA_ENABLE_KVS = "ResistenciaHabilitada";   // Nombre KVS para saber si la "Resistencia" debe funcionar o no según parámetros de funcionamiento. Valor numérico 1/0 para representar activa o no activa
let ELECTROVALVULA_ENABLE_KVS = "ElectrovalvulaHabilitada";   // Nombre KVS para saber si la "Resistencia" debe funcionar o no según parámetros de funcionamiento. Valor numérico 1/0 para representar activa o no activa
let HISTERESIS_SOLAR_ON_KVS = "HisteresisSolarON";   // Nombre KVS para saber si la histeresis "Electrovalvula" debe activarse. Formato numerico 9.9
let HISTERESIS_SOLAR_OFF_KVS = "HisteresisSolarOFF";   // Nombre KVS para saber si la histeresis "Electrovalvula" debe apagarse. Formato numerico 9.9
let HISTERESIS_TERMO_KVS = "HisteresisTermo";   // Nombre KVS para saber si la histeresis "Resistencia" debe apagarse o encenderse. Formato numerico 9.9
let MSG_ERROR_KVS = "MsgError";   // Texto con el mensaje de error, si sucede alguno

let POLL_MS       = 5000;        // Periodo de lectura (ms) de datos
```
