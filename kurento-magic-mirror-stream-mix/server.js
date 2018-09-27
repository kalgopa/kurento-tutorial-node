/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var path = require('path');
var url = require('url');
var cookieParser = require('cookie-parser')
var express = require('express');
var session = require('express-session')
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs    = require('fs');
var https = require('https');

var kurentoClient = null;

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8443/',
        ws_uri: 'ws://localhost:8888/kurento'
    }
});

var options =
{
key:  fs.readFileSync('keys/server.key'),
cert: fs.readFileSync('keys/server.crt')
};

var app = express();

/*
* Management of sessions
*/
app.use(cookieParser());

var sessionHandler = session({
    secret : 'none',
    rolling : true,
    resave : true,
    saveUninitialized : true
});

app.use(sessionHandler);

/*
* Definition of global variables.
*/
var sessions = {};
var candidatesQueue = {};


/*
* Server startup
*/
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function() {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
    server : server,
    path : '/magicmirror'
});

/*
* Management of WebSocket messages
*/
wss.on('connection', function(ws) {
    var sessionId = null;
    var request = ws.upgradeReq;
    var response = {
        writeHead : {}
    };

    sessionHandler(request, response, function(err) {
        sessionId = request.session.id;
        console.log('Connection received with sessionId ' + sessionId);
    });

    ws.on('error', function(error) {
        console.log('Connection ' + sessionId + ' error');
        stop(sessionId);
    });

    ws.on('close', function() {
        console.log('Connection ' + sessionId + ' closed');
        stop(sessionId);
    });

    ws.on('message', function(_message) {
        var message = JSON.parse(_message);
        console.log('Connection ' + sessionId + ' received message ', message);

        switch (message.id) {
        case 'start':
            sessionId = request.session.id;
            start(sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
                if (error) {
                    return ws.send(JSON.stringify({
                        id : 'error',
                        message : error
                    }));
                }
                ws.send(JSON.stringify({
                    id : 'startResponse',
                    sdpAnswer : sdpAnswer
                }));
            });
            break;

        case 'stop':
            stop(sessionId);
            break;

        case 'onIceCandidate':
            onIceCandidate(sessionId, message.candidate);
            break;

        default:
            ws.send(JSON.stringify({
                id : 'error',
                message : 'Invalid message ' + message
            }));
            break;
        }

    });
});






////////////// My APP

//var kurento = require('kurento-client');
//var kurentoClient = null;
/* 
var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8443/',
        ws_uri: 'ws://localhost:8888/kurento'
    }
});
*/

function getKurentoClient(callback) {
    if (kurentoClient !== null) {
    return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function(error, _kurentoClient) {
    if (error) {
        console.log("Could not find media server at address " + argv.ws_uri); 
        return callback("Could not find media server _____ at address" + argv.ws_uri +".Exiting with error" + error);
    }

    kurentoClient = _kurentoClient; 
    callback(null, kurentoClient);
    });
}

// From original app
app.use(express.static(path.join(__dirname, 'static')));

getKurentoClient(function callback(error, kurentoClient) {
    if (error) {
        return callback(error);
    }

    kurentoClient.create('MediaPipeline', function(error, pipeline) {
        if (error) {
            return callback(error);
        }

        createWebRtcEndpoint(pipeline, function(error, webrtcEndpoint) {
            if (error) {
                pipeline.release();
                return callback(error);
            }
            else {
                webRtcEndpoint.on('OnIceCandidate', function(event) {
                trickleIceCandidate(event.candidate); 
                });
                
                createRtpEndpoint(pipeline, function(error, rtpEndpoint) {
                    if (error) {
                        pipeline.release();
                        return callback(error);
                    }

                    connectMediaElements(webRtcEndpoint,rtpEndpoint, function(error) {
                        if (error) {
                            pipeline.release();
                            return callback(error);
                        }
                        else {
                            var sdp_rtp_offer = "v=0\n" + 
                            "o=- 0 0 IN IP4" + "rtp://35.174.195.124:5000" + "\n" + 
                            "s=gstreamer \n" + 
                            "c=IN IP4" + "rtp://35.174.195.124:5000" + "\n" + 
                            "t=0 o\n" + 
                            "m=video 6784 RTP/AVP 96\n" + 
                            "a=rtpmap:96 H264/90000\n" + 
                            "a=recvonly";
                            
                            rtpEndpoint.processOffer(sdp_rtp_offer, function(error, sdpAnswer){
                                if (error) {
                                    return callback(error);
                                }
                              sendSdpAnswer(sdpAnswer);
                            });
                        }

                    });
                });
            }
        });
    });
});
        


//////*Helper function to create the WebRtcEndpoint element. STUN server is configured */

function createWebRtcEndpoint(pipeline, callback) {
    pipeline.create('WebRtcEndpoint', {useDataChannels: false}, function(error, webRtcEndpoint) {
        if (error) {
            return callback(error);
        }

        webRtcEndpoint.setStunServerAddress("64.233.188.127");
        webRtEndpoint.setStunServerPort(19302);
        return callback(null, webRtcEndpoint); 
    });
}

/////* Helper function to create the RtpEndpoint element *////////// 

function createRtpEndpoint(pipeline, callback) {
    pipeline.create('RtpEndpoint', function(error, rtpEndpoint) {
        if (error) {
        return callback(error);
        }
        return callback(null, rtpEndpoint);
    });
}

/////////* Helper function to actually connect the WebRtcEndpoint and the RtpEndpoint creating the Media Pipeline *///////////////

function connectMediaElements(webRtcEndpoint, rtpEndpoint, callback) {
    webRtcEndpoint.connect(rtpEndpoint, function(error) {
        if (error) {
            return callback(error);
        }
        return callback(null);
    });
}


////////* SDP Exchange *//////////////////////////

myWebRtcEndpoint.processOffer(sdp, function(error, sdpAnswer) {
    if (error) {
        return callback(error);
    }
  sendSdpAnswer(sdpAnswer);
});

  
///////* To make Kurento start gathering ICE candidates *///////////

myWebRtcEndpoint.gatherCandidates(function(error) {
    if (error) { 
        return callback(error);
    }
});

//////////////// Trickle ICE Candidate *///////////

webRtcEndpoint.on('OnIceCandidate', function(event) {
    trickleIceCandidate(event.candidate); 
});
  
/////////// End of MY APP //////////



//////////////////////* START COMMENTING 
/*

/****************************************************************
    * Definition of functions
    

    // Recover kurentoClient for the first time.
    function getKurentoClient(callback) {
        if (kurentoClient !== null) {
            return callback(null, kurentoClient);
        }

        kurento(argv.ws_uri, function(error, _kurentoClient) {
            if (error) {
                console.log("Could not find media server at address " + argv.ws_uri);
                return callback("Could not find media server at address" + argv.ws_uri
                        + ". Exiting with error " + error);
            }

            kurentoClient = _kurentoClient;
            callback(null, kurentoClient);
        });
    }

    function start(sessionId, ws, sdpOffer, callback) {
        if (!sessionId) {
            return callback('Cannot use undefined sessionId');
        }

        getKurentoClient(function(error, kurentoClient) {
            if (error) {
                return callback(error);
            }

            kurentoClient.create('MediaPipeline', function(error, pipeline) {
                if (error) {
                    return callback(error);
                }

                createMediaElements(pipeline, ws, function(error, webRtcEndpoint, faceOverlayFilter) {
                    if (error) {
                        pipeline.release();
                        return callback(error);
                    }

                    if (candidatesQueue[sessionId]) {
                        while(candidatesQueue[sessionId].length) {
                            var candidate = candidatesQueue[sessionId].shift();
                            webRtcEndpoint.addIceCandidate(candidate);
                        }
                    }

                    connectMediaElements(webRtcEndpoint, faceOverlayFilter, function(error) {
                        if (error) {
                            pipeline.release();
                            return callback(error);
                        }

                        webRtcEndpoint.on('OnIceCandidate', function(event) {
                            var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                            ws.send(JSON.stringify({
                                id : 'iceCandidate',
                                candidate : candidate
                            }));
                        });

                        webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
                            if (error) {
                                pipeline.release();
                                return callback(error);
                            }

                            sessions[sessionId] = {
                                'pipeline' : pipeline,
                                'webRtcEndpoint' : webRtcEndpoint
                            }
                            return callback(null, sdpAnswer);
                        });

                        webRtcEndpoint.gatherCandidates(function(error) {
                            if (error) {
                                return callback(error);
                            }
                        });
                    });
                });
            });
        });
    }

    function createMediaElements(pipeline, ws, callback) {
        pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
            if (error) {
                return callback(error);
            }

            pipeline.create('FaceOverlayFilter', function(error, faceOverlayFilter) {
                if (error) {
                    return callback(error);
                }

                faceOverlayFilter.setOverlayedImage(url.format(asUrl) + 'img/mario-wings.png',
                        -0.35, -1.2, 1.6, 1.6, function(error) {
                    if (error) {
                        return callback(error);
                    }

                    return callback(null, webRtcEndpoint, faceOverlayFilter);
                });
            });
        });
    }

    function connectMediaElements(webRtcEndpoint, faceOverlayFilter, callback) {
        webRtcEndpoint.connect(faceOverlayFilter, function(error) {
            if (error) {
                return callback(error);
            }

            faceOverlayFilter.connect(webRtcEndpoint, function(error) {
                if (error) {
                    return callback(error);
                }

                return callback(null);
            });
        });
    }

    function stop(sessionId) {
        if (sessions[sessionId]) {
            var pipeline = sessions[sessionId].pipeline;
            console.info('Releasing pipeline');
            pipeline.release();

            delete sessions[sessionId];
            delete candidatesQueue[sessionId];
        }
    }

    function onIceCandidate(sessionId, _candidate) {
        var candidate = kurento.getComplexType('IceCandidate')(_candidate);

        if (sessions[sessionId]) {
            console.info('Sending candidate');
            var webRtcEndpoint = sessions[sessionId].webRtcEndpoint;
            webRtcEndpoint.addIceCandidate(candidate);
        }
        else {
            console.info('Queueing candidate');
            if (!candidatesQueue[sessionId]) {
                candidatesQueue[sessionId] = [];
            }
            candidatesQueue[sessionId].push(candidate);
        }
    }

    app.use(express.static(path.join(__dirname, 'static')));


////////////////* STOP COMMENTING *///////////////////