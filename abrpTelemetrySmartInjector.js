//
// activate sending and then launch an endless loop triggering a ticker.10 notice
// every 10 seconds
//

import PubSub from 'pubsub-js'
import {info, onetime, send} from './abrp.js'

// activate sending
send(1)

// main loop
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
while(true){
    PubSub.publish('ticker.10')
    await sleep(10000)
}