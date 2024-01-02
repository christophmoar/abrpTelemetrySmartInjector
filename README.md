# abrpTelemetrySmartInjector

<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![Apache License][license-shield]][license-url]

This script will fetch vehicle data from a smart-eq api adapter provider on an iobroker installation with a iobroker simple-api rest adapter to push it forward to the iternio abrp (aBetterRoutePlanner) telemetry api. 
The script will fetch the data from the upstream iobroker adapter every ten seconds, but you should configure your iobroker smart-eq api adapter to fetch the data from the smart api only every few minutes. 
I suggest something around 5-10 minutes only. Be conservative on this, do not overload the smart #1 api endpoints.

The script will then compare the fetched data with the previous data and decide (depending on various patterns) if the data is considered interesting enough/new enough to be sent to abrp telemetry api.
If yes, data is being sent over a http rest call to the abpr telemetry server.
The main script remains in an endless loop, repeating every ten seconds. It can/should be launched with the provided docker image, for example.

<!-- GETTING STARTED -->
## Getting Started

### Public docker image
You can find a prepackaged docker image here
https://hub.docker.com/r/christophmoar/smart-hashtag-one-abrp-injector

### Installation
The installation should be straight forward for everybody using the provided docker image, for example with the following command.
```
docker run --env-file .env --name smart-hashtag-one-abrp-injector -d christophmoar/smart-hashtag-one-abrp-injector
```

### Configuration 
You will need to setup a few environment variables for the docker. This is usally done with a .env file as you see in the above docker command.
The .env file should contain your setup data. 

```
ABRP_TOKEN={your abrp vehicle token, can be created in the abrp app}
PREFIX_IOBROKER_STATE={prefix for your vehicle state data in your iobroker, see example below}
PREFIX_IOBROKER_URL={prefix for the iobroker simple-api rest url, see example below}
```

You can check the prefix of your iobroker smart-eq adapter and your vehicle identification number (VIN) to setup the `PREFIX_IOBROKER_STATE` variable.
In the usual case that you only have a single smart-eq adapter on iobroker, it will have the number 0, so your `PREFIX_IOBROKER_STATE` value will be
```
PREFIX_IOBROKER_STATE=smart-eq.0.HES**************.
```
where `HES**************.` is your VIN followed by a single closing period.

The `PREFIX_IOBROKER_URL` is the http url which exposes the `simple-api` rest adapter activated in your iobroker installation.
You will have chosen a port and protocol (http/https) to expose the rest interface, so complete the configuration accordingly.
As an example, in my case its:
```
PREFIX_IOBROKER_STATE=http://{host}:{port}/getBulk/
```


## Data acquired via REST from iobroker
The following vehicle states will be fetched from iobroker

* `'status.additionalVehicleStatus.electricVehicleStatus.chargeIAct', // corresponding for 'v.c.current'`
* `'status.additionalVehicleStatus.electricVehicleStatus.distanceToEmptyOnBatteryOnly', // corresponding for 'v.b.range.ideal'`
* `'status.additionalVehicleStatus.electricVehicleStatus.chargeLevel', // corresponding for 'v.b.soc'`
* `'status.additionalVehicleStatus.electricVehicleStatus.chargerState', // corresponding for 'v.c.state'`
* `'status.parkTime.status', // corresponding for 'v.e.parktime'`
* `'status.additionalVehicleStatus.climateStatus.exteriorTemp', // corresponding for 'v.e.temp'`
* `'status.basicVehicleStatus.engineStatus', // corresponding for 'hx11.v.p.enginestatus'`


<!-- development notes -->
## Development notes
If you want to generate your own docker image from this repository, go ahead.

### Generating docker image

```
docker system prune -a 
docker build -t {your dockerhub username}/smart-hashtag-one-abrp-injector .
```

### Launching docker

```
docker run --env-file .env --name smart-hashtag-one-abrp-injector -d {your dockerhub username}/smart-hashtag-one-abrp-injector
```

### Publishing docker

```
docker login -u {your dockerhub username} 
docker push {your dockerhub username}/smart-hashtag-one-abrp-injector
```

<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE` for more information.

<!-- CONTACT -->
## Contact

Christoph Moar -  [@christophmoar.bsky.social](https://bsky.app/profile/christophmoar.bsky.social)

Project Link: [https://github.com/christophmoar/abrpTelemetrySmartInjector](https://github.com/christophmoar/abrpTelemetrySmartInjector)

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

This project relies on or is based on code from the following fine projects: 

This complete plugin framework has been cloned from Loxberry-Plugin-solaredge by ingenarius, thanks for the template.
The plugin itself and its usage would not be possible without these fine projects:

* fetching live data from iobroker smart-eq adapter (https://github.com/TA2k/ioBroker.smart-eq)
* then using either the iobroker rest-api adapter (https://github.com/ioBroker/ioBroker.rest-api)
* or the iobroker simple-api adapter (https://github.com/ioBroker/ioBroker.simple-api)
* to provide data to this script/daemon, which is using boilerplate code from abrp.js version as of 02.01.2023 (https://github.com/iternio/ovms-link/tree/dev) and (https://github.com/iternio/ovms-link/blob/dev/lib/abrp.js)
* the abrp telemetry data is defined here (https://documenter.getpostman.com/view/7396339/SWTK5a8w)
* and since the abrp script above is using the openvehicles metrics naming convention you can find it here (https://docs.openvehicles.com/en/latest/userguide/metrics.html)

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/christophmoar/abrpTelemetrySmartInjector.svg?style=for-the-badge
[contributors-url]: https://github.com/christophmoar/abrpTelemetrySmartInjector/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/christophmoar/abrpTelemetrySmartInjector.svg?style=for-the-badge
[forks-url]: https://github.com/christophmoar/abrpTelemetrySmartInjector/network/members
[stars-shield]: https://img.shields.io/github/stars/christophmoar/abrpTelemetrySmartInjector.svg?style=for-the-badge
[stars-url]: https://github.com/christophmoar/abrpTelemetrySmartInjector/stargazers
[issues-shield]: https://img.shields.io/github/issues/christophmoar/abrpTelemetrySmartInjector.svg?style=for-the-badge
[issues-url]: https://github.com/christophmoar/abrpTelemetrySmartInjector/issues
[license-shield]: https://img.shields.io/github/license/christophmoar/abrpTelemetrySmartInjector.svg?style=for-the-badge
[license-url]: https://github.com/christophmoar/abrpTelemetrySmartInjector/blob/main/LICENSE


