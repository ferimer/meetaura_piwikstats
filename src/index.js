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

function main() {
  getUsersPromises()
  .then(promises => Promise.all(promises))
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
      'RECOMENDACIÓN', 'BÚSQUEDA', 'WIFI'
    ]]
    usersData.forEach(d =>
      data.push([
        d.userId, formatDate(d.date), d.time, formatDuration(d.duration),
        d.login, d.actions, d.rating,
        d.output, d.sms, d.channel_change, d.from_beginning, d.tv_info,
        d.recomendation, d.search, d.wifi
      ])
    )
    let buffer = xlsx.build([
      {
        name: 'DETALLE VISITAS',
        data
      }
    ])
    fs.writeFileSync('meetaura-stats.xlsx', buffer)
    console.log('Done')
  })
  .catch((error) => {
    console.error(`Error: ${error}`)
    process.exit()
  })
}

const usersData = [];
function storeUserStats(user) {
  user.lastVisits.forEach(visit => {
    let data = {
      userId: user.userId,
      date: visit.serverTimestamp,
      time: visit.serverTimePretty,
      duration: 0,
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
          data.duration = action.eventValue || visit.visitDuration || 0
          break

        case 'sms_requesting':
          data.sms = action.eventName === 'accepted' ? 'Si': 'No'
          break


        case 'valoration':
          data.rating = data.eventValue
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
              data.wifi++
              data.actions++
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

main();
