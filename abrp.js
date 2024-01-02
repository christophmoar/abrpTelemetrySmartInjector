/**
 * abrp telemetry injector for smart #1
 *   please note comments identified by: abrp/smart/#1
 * 
 * fetching live data from iobroker smart-eq adapter
 *   https://github.com/TA2k/ioBroker.smart-eq
 * 
 * then using either the iobroker rest-api adapter
 *   https://github.com/ioBroker/ioBroker.rest-api
 * 
 * or the iobroker simple-api
 *   https://github.com/ioBroker/ioBroker.simple-api
 * 
 * to provide data to this script/daemon, which is using boilerplate code from abrp.js
 *   version as of 02.01.2023
 *   https://github.com/iternio/ovms-link/tree/dev
 *   https://github.com/iternio/ovms-link/blob/dev/lib/abrp.js
 * 
 * the abrp telemetry data is defined here
 *   https://documenter.getpostman.com/view/7396339/SWTK5a8w
 * 
 * and since this script is using the openvehicles metrics naming convention you can find it here
 *   https://docs.openvehicles.com/en/latest/userguide/metrics.html
 */

import PubSub from 'pubsub-js'
import fetch from 'sync-fetch'
import axios from 'axios'

// NOTE: const in duktape implementation is not much more than var offers
// https://wiki.duktape.org/postes5features
const DEBUG = false
const MIN_CALIBRATION_SPEED = 70 // kph
const OVMS_API_KEY = '32b2162f-9599-4647-8139-66e9f9528370'
const VERSION = '2.0.1'

const ABRP_TOKEN = process.env.ABRP_TOKEN
const PREFIX_IOBROKER_STATE = process.env.PREFIX_IOBROKER_STATE
const PREFIX_IOBROKER_URL = process.env.PREFIX_IOBROKER_URL

//
// some helper methods defined to later apply minimal changes to the boilerplate code abrp.js
// to make it run outside of Ovms
//

// these are tickers for high and low frequency. 
// in our case we will later disable high frequency subscription, since our indirections induce way too much latency anyway
// for calling the ioBroker rest api, which will get data fetched asynchronously by smart-eq rest api adapter once a minute
const TICKER_HIGH_FREQUENCY = 'ticker.1'
const TICKER_LOW_FREQUENCY = 'ticker.10'

// Don't keep the modem connection live just for the sake of sending data.
// Only very periodically send an update if the car is simply parked somewhere.
const MAX_ELAPSED_DURATION = 24 * 3600 // 24 hours

// this initializes a fake user config from default
const DEFAULT_CFG = {
  "user_token": ABRP_TOKEN,      
}
var usr_cfg = JSON.parse(JSON.stringify(DEFAULT_CFG))

// metricnames in ovms semantics
// https://docs.openvehicles.com/en/latest/userguide/metrics.html
const allLocalOvmsMetricNames = [
  'v.b.current',
  'v.c.current',
  'v.b.power',
  'v.b.range.ideal',
  'v.b.soc',
  'v.b.soh',
  'v.b.temp',
  'v.b.voltage',
  'v.c.kwh',
  'v.c.mode',
  'v.c.state', // v.c.charging is also true when regenerating, which isn't what is wanted
  'status.parkTime.status',
  'v.e.temp',
  'v.p.altitude',
  'v.p.direction',
  'v.p.latitude',
  'v.p.longitude',
  'v.p.odometer',
  'v.p.speed',
  // Nissan Leaf specific metrics
  'xnl.v.b.range.instrument',
  'xnl.v.b.soc.instrument',
  'xnl.v.b.soh.instrument',
  // smart #1 specific metricx
  'hx11.v.p.enginestatus'
]

// corresponding iobroker metricnames
const allLocalIobrokerMetricNames = [
  'undefined', // no corresponding for 'v.b.current'
  'status.additionalVehicleStatus.electricVehicleStatus.chargeIAct', // corresponding for 'v.c.current'
  'undefined', // no corresponding for 'v.b.power'
  'status.additionalVehicleStatus.electricVehicleStatus.distanceToEmptyOnBatteryOnly', // corresponding for 'v.b.range.ideal'
  'status.additionalVehicleStatus.electricVehicleStatus.chargeLevel', // corresponding for 'v.b.soc'
  'undefined', // no corresponding for 'v.b.soh'
  'undefined', // no corresponding for 'v.b.temp'
  'undefined', // no corresponding for 'v.b.voltage'
  'undefined', // no corresponding for 'v.c.kwh'
  'undefined', // no corresponding for 'v.c.mode'
  'status.additionalVehicleStatus.electricVehicleStatus.chargerState', // corresponding for 'v.c.state'
  'status.parkTime.status', // corresponding for 'v.e.parktime'
  'status.additionalVehicleStatus.climateStatus.exteriorTemp', // corresponding for 'v.e.temp'
  'undefined', // for now no corresponding for 'v.p.altitude' since it would be too old anyway
  'undefined', // no corresponding for 'v.p.direction'
  'undefined', // for now no corresponding for 'v.p.latitude' since it would be too old anyway
  'undefined', // for now no corresponding for 'v.p.longitude' since it would be too old anyway
  'undefined', // for now no corresponding for 'v.p.odometer' since it would be too old anyway
  'undefined', // for now no corresponding for 'v.p.speed' since it would be too old anyway
  'undefined', // for now no corresponding for 'xnl.v.b.range.instrument'
  'undefined', // for now no corresponding for 'xnl.v.b.soc.instrument'
  'undefined', // for now no corresponding for 'xnl.v.b.soh.instrument'
  'status.basicVehicleStatus.engineStatus', // corresponding for 'hx11.v.p.enginestatus'
]

// now keep only the mapped metric names
const localOvmsMetricNames = [
  'v.c.current',
  'v.b.range.ideal',
  'v.b.soc',
  'v.c.state',
  'v.e.parktime',
  'v.e.temp',
  'hx11.v.p.enginestatus'
]

// these are the high frequency metric names, they are completely ignored for now since we do not have a mapping for them
// and since we are not doing high frequency anyway 
const allLocalHighFrequencyMetricNames = [
  'v.b.power', 'v.p.speed'
]

const localHighFrequencyMetricNames = [
]

// this is the mapping table from ovmsMetric to iobroker and reverse
const localOvmsMetricMap = {
  'v.c.current': PREFIX_IOBROKER_STATE+'status.additionalVehicleStatus.electricVehicleStatus.chargeIAct',
  'v.b.range.ideal': PREFIX_IOBROKER_STATE+'status.additionalVehicleStatus.electricVehicleStatus.distanceToEmptyOnBatteryOnly',
  'v.b.soc': PREFIX_IOBROKER_STATE+'status.additionalVehicleStatus.electricVehicleStatus.chargeLevel',
  'v.c.state': PREFIX_IOBROKER_STATE+'status.additionalVehicleStatus.electricVehicleStatus.chargerState',
  'v.e.parktime': PREFIX_IOBROKER_STATE+'status.parkTime.status',
  'v.e.temp': PREFIX_IOBROKER_STATE+'status.additionalVehicleStatus.climateStatus.exteriorTemp',
  'hx11.v.p.enginestatus': PREFIX_IOBROKER_STATE+'status.basicVehicleStatus.engineStatus',
};

// localNotifyRaise(type, subtype, message)
// replacement for https://docs.openvehicles.com/en/latest/userguide/scripting.html#ovmsnotify
function localNotifyRaise(type, subtype, message) {
  if(type == 'error')
    localConsole.error(subtype + ': ' + message)
  else if(type == 'info')
    localConsole.info(subtype + ': ' + message)
  else
    localConsole.log(subtype + ': ' + message)
}

// localConfigGetValues(param, [prefix])
// https://docs.openvehicles.com/en/latest/userguide/scripting.html#ovmsconfig
function localConfigGetValues(param, prefix) {
  if(param == 'usr')
    return usr_cfg
  else
    return undefined
}

// localConfigSetValues(param, prefix, object)
// no-op replacement for https://docs.openvehicles.com/en/latest/userguide/scripting.html#ovmsconfig
function localConfigSetValues(param, prefix, object) {
}

// localMetricsGetValues(metricNames)
// replacement for https://docs.openvehicles.com/en/latest/userguide/scripting.html#ovmsmetrics
function localMetricsGetValues(metricNames) {
  var collectedMetrics = []
  
  // loop over all metricNames to setup our rest url
  var aRestUrl = PREFIX_IOBROKER_URL
  metricNames.forEach((metricName) => {
    if(aRestUrl.slice(-1) != '/')
      aRestUrl = aRestUrl + ','
    aRestUrl = aRestUrl + localOvmsMetricMap[metricName] 
  });

  // synchronous fetch and read/mapping of incoming data
  const json = fetch(aRestUrl).json()
  Object.entries(json).forEach(([key, value]) => {
    
    var aKey = metricNames[key] 
    switch(aKey) {
      case 'v.c.state':
        collectedMetrics[aKey] = (value.val == '2' ? 'charging' : 'stopped') 
        break
      case 'v.c.current':
        collectedMetrics[aKey] = Number(value.val) * -1 
        break
      case 'v.e.parktime':
        collectedMetrics[aKey] = round( (Date.now() - Number(value.val)) / 1000)
        break
      case 'hx11.v.p.enginestatus':
        collectedMetrics[aKey] = value.val 
        break
      default:
        collectedMetrics[aKey] = Number(value.val)
    }
    
  });

  return collectedMetrics
}

// subscribe and unsubscribe low and high frequency
// we want to disable high frequency for now, since
// no-op replacement for https://docs.openvehicles.com/en/latest/userguide/scripting.html#ovmsmetrics
function localSubscribeHighFrequency() {
}

function localUnsubscribeHighFrequency() {
}

//
// basic boilerplate code from https://github.com/iternio/ovms-link/blob/dev/lib/abrp.js
// with adaptions to run outside of Ovms
// 

function clone(obj) {
  return Object.assign({}, obj)
}

function isNil(value) {
  return value == null
}

function timestamp() {
  return new Date().toLocaleString()
}

// simple console shim
function logger() {
  function log(message, obj) {
    //console.log(message + (obj ? ' ' + JSON.stringify(obj) : '') + '\n')
    console.log(message + (obj ? ' ' + JSON.stringify(obj) : ''))
  }

  function debug(message, obj) {
    if (DEBUG) {
      log('(' + timestamp() + ') DEBUG: ' + message, obj)
    }
  }

  function error(message, obj) {
    log('(' + timestamp() + ') ERROR: ' + message, obj)
  }

  function info(message, obj) {
    log('(' + timestamp() + ') INFO: ' + message, obj)
  }

  function warn(message, obj) {
    log('(' + timestamp() + ') WARN: ' + message, obj)
  }

  return {
    debug,
    error,
    info,
    log,
    warn,
  }
}

function omitNil(obj) {
  const cloned = clone(obj)
  const keys = Object.keys(cloned)
  keys.forEach(function (key) {
    if (isNil(cloned[key])) {
      delete cloned[key]
    }
  })
  return cloned
}

function round(number, precision) {
  if (!number) {
    return number // could be 0, null or undefined
  }
  return Number(number.toFixed(precision || 0))
}

function medianPowerMetrics(array) {
  if (!array.length) {
    return null
  }
  // Find the median based on the power metric
  const sorted = array.slice().sort(function (a, b) {
    return a.power - b.power
  })
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    // Don't try and average the readings as they could have been some seconds
    // apart. Simply return the reading closest to the sorted middle with the
    // lower power reading.
    return sorted[midpoint - 1]
  } else {
    return sorted[midpoint]
  }
}

// abrp/smart/#1
// do not override console object with the logger defined inside this module, better use a localConsole
// and substitute every console() call with a localConsole() call in the whole module

//const console = logger()
const localConsole = logger()

var collectedMetrics = []
var lastSentTelemetry = {
  utc: 0,
}
var subscribedLowFrequency = false
var subscribedHighFrequency = false

function collectHighFrequencyMetrics() {
  const highFrequencyMetricNames = localHighFrequencyMetricNames
  // abrp/smart/#1 use localMetricsGetValues
  const metrics = localMetricsGetValues(highFrequencyMetricNames)
  const power = metrics['v.b.power']
  const speed = metrics['v.p.speed']
  if (!isNil(power) && !isNil(speed)) {
    collectedMetrics.push({
      power,
      speed,
    })
  }
}

function getOvmsMetrics() {
  // https://docs.openvehicles.com/en/latest/userguide/metrics.html
  const metricNames = localOvmsMetricNames
  
  // abrp/smart/#1 use localMetricsGetValues
  const aResult = localMetricsGetValues(metricNames)
  return aResult
}

function getUsrAbrpConfig() {
  // abrp/smart/#1 use localConfigGetValues
  return localConfigGetValues('usr', 'abrp.')
}

function isSignificantTelemetryChange(currentTelemetry, previousTelemetry) {
  // Significant if the SOC changes so that it updates in ABRP as soon as
  // possible after it's changed within the vehicle.
  if (currentTelemetry.soc !== previousTelemetry.soc) {
    return true
  }
  // Significant change if either the is_parked or is_charging states changes
  if (currentTelemetry.is_charging !== previousTelemetry.is_charging) {
    return true
  }
  if (currentTelemetry.is_parked !== previousTelemetry.is_parked) {
    return true
  }
  // Significant change if the power changes by more than 1 kW while charging.
  // Another piece of information that is clearly shown within ABRP so good
  // to be responsive to those changes in charging power.
  if (
    currentTelemetry.is_charging &&
    round(currentTelemetry.power) !== round(previousTelemetry.power)
  ) {
    return true
  }
  // Otherwise, updates purely based on timing considerations based on the
  // current state of the metrics and when the last telemetry was sent
  return false
}

function mapMetricsToTelemetry(metrics) {
  const chargingStates = ['charging', 'topoff']
  const dcfcMode = 'performance'
  // Array.prototype.includes() not supported in duktape
  // TODO: confirm if is_charging is supposed to be true if regenerative braking is
  // charging the battery.
  
  // abrp/smart/#1
  const is_charging = chargingStates.indexOf(metrics['v.c.state']) > -1
  
  // abrp/smart/#1
  const engine_status = metrics['hx11.v.p.enginestatus'] // engine_off
  const is_parked = metrics['v.e.parktime'] > 60 && engine_status == 'engine_off'
  
  // abrp/smart/#1
  //const kwh_charged = is_charging ? round(metrics['v.c.kwh'], 1) : 0
  const kwh_charged = undefined
  
  // abrp/smart/#1
  //const is_dcfc = is_charging && dcfcMode === metrics['v.c.mode']
  const is_dcfd = undefined
  
  // The instrument range reported by the Nissan Leaf OVMS metrics doesn't
  // appear to update when the car is parked and then charged. So, use the
  // generic vehicle ideal range when it's more than 10% of the reported
  // instrument range.
  const instrumentRange = round(metrics['xnl.v.b.range.instrument']) || 0
  const idealRange = round(metrics['v.b.range.ideal'])
  
  // abrp/smart/#1
  const current = (is_charging ? round(metrics['v.c.current'], 1) : undefined)
  
  // https://documenter.getpostman.com/view/7396339/SWTK5a8w
  const telemetry = {
    utc: round(Date.now() / 1000),
    soc: round(metrics['xnl.v.b.soc.instrument']) || round(metrics['v.b.soc']),
    power: round(metrics['v.b.power'], 2), // ~ nearest 10W of precision
    speed: round(metrics['v.p.speed']),
    lat: round(metrics['v.p.latitude'], 5), // ~1.11 m of precision
    lon: round(metrics['v.p.longitude'], 5), // ~1.11 m of precision
    is_charging,
    is_dcfd,
    is_parked,
    kwh_charged,
    soh: round(metrics['xnl.v.b.soh.instrument']) || round(metrics['v.b.soh']),
    heading: round(metrics['v.p.direction'], 1),
    elevation: round(metrics['v.p.altitude'], 1),
    ext_temp: round(metrics['v.e.temp']),
    batt_temp: round(metrics['v.b.temp']),
    voltage: round(metrics['v.b.voltage']),
    current,
    odometer: round(metrics['v.p.odometer']),
    est_battery_range:
      idealRange > 1.1 * instrumentRange ? idealRange : instrumentRange,
  }
  // localConsole.debug('Mapped ABRP telemetry', telemetry)
  // Omit nil properties as ABRP doesn't appreciate getting them.
  return omitNil(telemetry)
}

function sendTelemetry(telemetry) {
  const config = getUsrAbrpConfig()
  const token = config.user_token
  if (!token) {
    localConsole.error('config usr abrp.user_token not set')
    return
  }
  localConsole.info('Sending telemetry to ABRP', telemetry)
  const url =
    'https://api.iternio.com/1/tlm/send?api_key=' +
    encodeURIComponent(OVMS_API_KEY) +
    '&token=' +
    encodeURIComponent(token) +
    '&tlm=' +
    encodeURIComponent(JSON.stringify(telemetry))
    
  // abrp/smart/#1
  /*
  HTTP.Request({
    done: function (response) {
      if (response.statusCode !== 200) {
        localConsole.warn('Non 200 response from ABRP', response)
      }
    },
    fail: function (error) {
      localConsole.error('ABRP error', error)
    },
    url,
  })
  */

  // make the async call using axios
  axios.get(url)
    .then(response => {
      if (response.status !== 200) {
        console.warn('Non 200 response from ABRP', response.data);
      }      
    })
    .catch(error => {
      localConsole.error('ABRP error', error)
    });  
}

function sendTelemetryIfNecessary() {
  
  const maxCalibrationTimeout = 5 // seconds
  const maxChargingTimeout = 30 * 60 // 30 minutes
  const staleConnectionTimeout = 3 * 60 // 3 minutes for OVMS API Key
  const staleConnectionTimeoutBuffer = 20 // seconds

  const metrics = getOvmsMetrics()
  const currentTelemetry = mapMetricsToTelemetry(metrics)

  // If being collected, somewhat smooth the point in time power and speed
  // reported using the metrics for the median power entry from those collected
  // at a higher frequency
  if (collectedMetrics.length) {
    localConsole.debug('Collected metrics', collectedMetrics)
    const medianMetrics = medianPowerMetrics(collectedMetrics)
    if (!isNil(medianMetrics)) {
      localConsole.debug('Median power metrics', medianMetrics)
      currentTelemetry.power = round(medianMetrics.power, 2) // ~ nearest 10W of precision
      currentTelemetry.speed = round(medianMetrics.speed)
    }
    // And then clear the collected metrics for the next low frequency pass
    collectedMetrics = []
  }

  const elapsed = currentTelemetry.utc - lastSentTelemetry.utc
  var maxElapsedDuration
  
  // abrp/smart/#1 if we do not have status parked or dcfc, skip a conditional branch below
  const isStatusUndefined = (currentTelemetry.is_parked === undefined && currentTelemetry.is_dcfc === undefined )
  
  if (isSignificantTelemetryChange(currentTelemetry, lastSentTelemetry)) {
    localConsole.info('Significant telemetry change')
    maxElapsedDuration = 0 // always send
  } else if (currentTelemetry.speed > MIN_CALIBRATION_SPEED) {
    localConsole.info('Speed greater than minimum calibration speed')
    maxElapsedDuration = maxCalibrationTimeout
  } else if ((!isStatusUndefined) && (!currentTelemetry.is_parked || currentTelemetry.is_dcfc)) {
    localConsole.info('Not parked or DC fast charging')
    maxElapsedDuration = staleConnectionTimeout - staleConnectionTimeoutBuffer
  } else if (currentTelemetry.is_charging) {
    localConsole.info('Standard charging')
    // Only needed if SOC significant change doesn't trigger
    maxElapsedDuration = maxChargingTimeout
  } else {
    // Don't keep the modem connection live just for the sake of sending data.
    // Only very periodically send an update if the car is simply parked
    // somewhere.
    maxElapsedDuration = MAX_ELAPSED_DURATION
  }

  if (elapsed >= maxElapsedDuration) {
    sendTelemetry(currentTelemetry)
    lastSentTelemetry = clone(currentTelemetry)
  }
  // Subscribe to high frequency metric collection only if not parked
  if (currentTelemetry.is_parked) {
    // abrp/smart/#1 use localUnsubscribeHighFrequency
    localUnsubscribeHighFrequency()
  } else {
    // abrp/smart/#1 use localSubscribeHighFrequency
    localSubscribeHighFrequency()
  }
}

function validateUsrAbrpConfig() {
  const config = getUsrAbrpConfig()
  if (!config.user_token) {
    // abrp/smart/#1 use localNotifyRaise
    localNotifyRaise(
      'error',
      'usr.abrp.status',
      'ABRP::config usr abrp.user_token not set'
    )
    return false
  }
  return true
}

function subscribeHighFrequency() {
  if (!subscribedHighFrequency) {
    localConsole.debug('Subscribing to collectHighFrequencyMetrics')
    PubSub.subscribe(TICKER_HIGH_FREQUENCY, collectHighFrequencyMetrics)
  }
  subscribedHighFrequency = true
}

function subscribeLowFrequency() {
  if (!subscribedLowFrequency) {
    localConsole.debug('Subscribing to sendTelemetryIfNecessary')
    PubSub.subscribe(TICKER_LOW_FREQUENCY, sendTelemetryIfNecessary)
    PubSub.subscribe('vehicle.on', sendTelemetryIfNecessary)
    PubSub.subscribe('vehicle.off', sendTelemetryIfNecessary)
  }
  subscribedLowFrequency = true
}

function unsubscribeLowFrequency() {
  if (subscribedLowFrequency) {
    // unsubscribe can be passed the subscription identifier or the function
    // reference to unsubscribe from all events using that handler
    localConsole.debug('Unsubscribing from sendTelemetryIfNecessary')
    PubSub.unsubscribe(sendTelemetryIfNecessary)
  }
  subscribedLowFrequency = false
  // Also unsubscribe from high frequency
  unsubscribeHighFrequency()
}

function unsubscribeHighFrequency() {
  if (subscribedHighFrequency) {
    localConsole.debug('Unsubscribing from collectHighFrequencyMetrics')
    PubSub.unsubscribe(collectHighFrequencyMetrics)
  }
  subscribedHighFrequency = false
}

// API method abrp.onetime():
function onetime() {
  if (!validateUsrAbrpConfig()) {
    return
  }
  const metrics = getOvmsMetrics()
  const telemetry = mapMetricsToTelemetry(metrics)
  sendTelemetry(telemetry)
}

// API method abrp.info():
function info() {
  const metrics = getOvmsMetrics()
  const telemetry = mapMetricsToTelemetry(metrics)
  // space before units as per NIST guidelines https://physics.nist.gov/cuu/Units/checklist.html
  localConsole.log('Plugin Version:   ' + VERSION)
  localConsole.log('State of Charge:  ' + telemetry.soc + ' %')
  localConsole.log('Battery Power:    ' + telemetry.power + ' kW')
  localConsole.log('Vehicle Speed:    ' + telemetry.speed + ' kph')
  localConsole.log('GPS Latitude:     ' + telemetry.lat + ' °')
  localConsole.log('GPS Longitude:    ' + telemetry.lon + ' °')
  localConsole.log('Charging:         ' + telemetry.is_charging)
  localConsole.log('DC Fast Charging: ' + telemetry.is_dcfc)
  localConsole.log('Parked:           ' + telemetry.is_parked)
  localConsole.log('Charged kWh:      ' + telemetry.kwh_charged)
  localConsole.log('State of Health:  ' + telemetry.soh + ' %')
  localConsole.log('GPS Heading:      ' + telemetry.heading + ' °')
  localConsole.log('GPS Elevation:    ' + telemetry.elevation + ' m')
  localConsole.log('External Temp:    ' + telemetry.ext_temp + ' °C')
  localConsole.log('Battery Temp:     ' + telemetry.batt_temp + ' °C')
  localConsole.log('Battery Voltage:  ' + telemetry.voltage + ' V')
  localConsole.log('Battery Current:  ' + telemetry.current + ' A')
  localConsole.log('Odometer:         ' + telemetry.odometer + ' km')
  localConsole.log('Estimated Range:  ' + telemetry.est_battery_range + ' km')
}

// API method abrp.resetConfig()
function resetConfig() {
    // abrp/smart/#1 use localConfigSetValues localNotifyRaise
  localConfigSetValues('usr', 'abrp.', {})
  localNotifyRaise('info', 'usr.abrp.status', 'ABRP::usr abrp config reset')
}

// API method abrp.send():
function send(onoff) {
  if (onoff) {
    if (!validateUsrAbrpConfig()) {
      return
    }
    if (subscribedLowFrequency) {
      localConsole.warn('Already running !')
      return
    }
    localConsole.info('Start sending data...')
    subscribeLowFrequency()
    // abrp/smart/#1 use localNotifyRaise
    localNotifyRaise('info', 'usr.abrp.status', 'ABRP::started')
  } else {
    if (!subscribedLowFrequency) {
      localConsole.warn('Already stopped !')
      return
    }
    localConsole.info('Stop sending data')
    unsubscribeLowFrequency()
    // abrp/smart/#1 use localNotifyRaise
    localNotifyRaise('info', 'usr.abrp.status', 'ABRP::stopped')
  }
}

/*
module.exports = {
  medianPowerMetrics, // jest
  omitNil, // jest
  info,
  onetime,
  send,
  resetConfig,
  round, // jest
} 
*/

export {info, onetime, send}

