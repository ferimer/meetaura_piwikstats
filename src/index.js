'use strict';

// CONFIGURATION PARAMETERS
const {token, period, date, piwik_uri, idSite} = require('./config.json');

// PIWIK URI
const baseURI = `${piwik_uri}?module=API&token_auth=${token}&idSite=${idSite}&format=JSON&period=${period}&date=${date}`;

// MODULES
const moment = require('moment');
const zeroFill = require('zero-fill');
const rp = require('request-promise');
const xlsx = require('node-xlsx');
const fs = require('fs');
const csv = require('node-csv').createParser();

function PiwikReportingApi(method, parameters) {
  let params = '';
  Object.keys(parameters).forEach(param_name => {
    params = `&${param_name}=${parameters[param_name]}`
  });

  return rp({
    uri: `${baseURI}&method=${method}${params}`,
    json: true
  });
}

function processPollPromise(file) {
  if (file) {
    console.log(`Loading poll from ${file}`)
    return new Promise(resolve => {
      fs.readFile(file, (err, buffer) => {
        if (err) {
          console.error(`Error reading ${file}. Exiting`)
          process.exit()
        }

        csv.parse(buffer, (err, data) => {
          if (err) {
            console.error(`Error parsing ${file}. Exiting`)
            process.exit()
          }
          resolve(data)
        })
      })
    })
  } else {
    // No poll, empty data
    return Promise.resolve([[]])
  }

}

function getUsersPromises() {
  return PiwikReportingApi('UserId.getUsers', {})
  .then(usersBody => {
    return usersBody.map(user => PiwikReportingApi('Live.getVisitorProfile', {
        visitorId: user.idvisitor
      }))
  })
  .catch(error => {
    console.error(`Error getting users from Piwik: ${error}`)
    process.exit()
  })
}

// Looks for a Poll near timestamp on pollData array
function getPollId(pollData, timestamp) {
  const statsTime = moment(timestamp)
  for (let i = 2; i < pollData.length; i++) {
    let row = pollData[i]
    let milliseconds = moment(row[7]) - statsTime
    if (milliseconds > 0 && milliseconds < 600000) { // 10 minutes difference
      return row[0]
    }
  }
  return ''
}

function main(pollFile) {
  let pollData = null

  Promise.all([
    processPollPromise(pollFile),
    getUsersPromises()
  ])
  .then(poll_user_promises => {
    pollData = poll_user_promises[0]
    return Promise.all(poll_user_promises[1])
  })
  .then(users => {
    console.log('All data recovered. Processing...')
    // TODO: Filtrar por tienda
    users.forEach(storeUserStats)
    console.log('Done')
    return usersData
  })
  .then(usersData => {
    function formatDate(timestamp) {
      return moment(timestamp * 1000).toISOString()
    }
    function formatDuration(seconds) {
      let aux = seconds / 60
      let minutes = Math.floor(aux)
      return `${zeroFill(2, minutes, '0')}:${zeroFill(2, Math.round((aux - minutes) * 60), '0')}`
    }

    console.log('Generating XLSX ...')
    let data = [[
      'USER_ID', 'FECHA', 'HORA', 'DURACIÓN', 'LOGIN', '#ACCIONES', 'RATING',
      'SALIDA', 'SMS', 'CAMBIO CANAL', 'VER PRINCIPIO', 'TV INFO',
      'RECOMENDACIÓN', 'BÚSQUEDA', 'WIFI', 'ENCUESTA'
    ]]
    usersData.forEach(d =>
      data.push([
        d.userId, d.serverDate, d.time, d.visitDurationPretty,
        d.login, d.actions, d.rating,
        d.output, d.sms, d.channel_change, d.from_beginning, d.tv_info,
        d.recomendation, d.search, d.wifi, getPollId(pollData, d.date * 1000)
      ])
    )
    let tabs = [
      {
        name: 'DETALLE VISITAS',
        data
      }
    ]
    if (pollFile) {
      tabs.push({
        name: 'ENCUESTA',
        data: pollData
      })
    }
    fs.writeFileSync('meetaura-stats.xlsx', xlsx.build(tabs))
    console.log('Done')
  })
  .catch((error) => {
    console.error(`Error: ${error}`)
    process.exit()
  })
}

const usersData = [];
function storeUserStats(user) {
  console.log(user.lastVisits.length);
  user.lastVisits.forEach(visit => {
    let data = {
      userId: user.userId,
      date: visit.serverTimestamp,
      serverDate: visit.serverDate,
      time: visit.serverTimePretty,
      //time: visit.visitLocalTime,
      duration: 0,
      visitDurationPretty: visit.visitDurationPretty,
      visitDuration: visit.visitDuration,
      login: 'N/A',
      actions: 0,
      rating: 'N/A',
      output: 'N/A',
      sms: 'N/A',
      channel_change: 0,
      from_beginning: 0,
      tv_info: 0,
      recomendation: 0,
      search: 0,
      wifi: 0
    }
    visit.actionDetails.forEach(action => {
      switch (action.eventAction) {
        case 'user_type':
          if (action.eventName === 'login_real') {
            data.login = 'REAL'
          } else {
            data.login = 'ARQUETIPO'
          }
          break

        case 'session':
          data.duration = action.eventValue || 0
          break

        case 'sms_requesting':
          data.sms = action.eventName === 'accepted' ? 'Si': 'No'
          break


        case 'valoration':
          data.rating = action.eventValue
          break

        case 'wifi':
          if (action.eventName === 'goodbye') data.output = 'WIFI'
          break

        case 'intent':
          switch (action.eventName) {
            case 'desco_change_channel':
              data.channel_change++
              data.actions++
              break

            case 'desco_from_beginning':
              data.from_beginning++
              data.actions++
              break

            case 'tv_search':
              data.search++
              data.actions++
              break

            case 'tv_profiling':
              data.recomendation++
              data.actions++
              break

            case 'desco_info':
              data.tv_info++
              data.actions++
              break

            case 'wifi_info':
            case 'wifi_enable':
              data.wifi++
              data.actions++
              data.output = "WIFI"
              break

            case 'goodbye':
              data.output = 'BYE'
              break
          }
      }
    })
    usersData.push(data)
  })
}

//////

let encuestaPos = process.argv.indexOf('-q')
let encuesta = null
if (encuestaPos > 0 && process.argv.length > encuestaPos + 1) {
  encuesta = process.argv[encuestaPos+1]
}

main(encuesta);
