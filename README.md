![Logo](admin/twinkly.png)
# ioBroker.twinkly

![Number of Installations (latest)](http://iobroker.live/badges/twinkly-installed.svg)
![Number of Installations (stable)](http://iobroker.live/badges/twinkly-stable.svg)
[![NPM version](http://img.shields.io/npm/v/iobroker.twinkly.svg)](https://www.npmjs.com/package/iobroker.twinkly)
[![Downloads](https://img.shields.io/npm/dm/iobroker.twinkly.svg)](https://www.npmjs.com/package/iobroker.twinkly)
[![Dependency Status](https://img.shields.io/david/patrickbs96/iobroker.twinkly.svg)](https://david-dm.org/patrickbs96/iobroker.twinkly)
[![Known Vulnerabilities](https://snyk.io/test/github/patrickbs96/ioBroker.twinkly/badge.svg)](https://snyk.io/test/github/patrickbs96/ioBroker.twinkly)

[![NPM](https://nodei.co/npm/iobroker.twinkly.png?downloads=true)](https://nodei.co/npm/iobroker.twinkly/)

**Tests:** Linux/Mac: [![Travis-CI](https://travis-ci.com/patrickbs96/ioBroker.twinkly.svg)](https://travis-ci.com/github/patrickbs96/ioBroker.twinkly)
Windows: [![AppVeyor](https://ci.appveyor.com/api/projects/status/github/patrickbs96/ioBroker.twinkly?branch=master&svg=true)](https://ci.appveyor.com/project/patrickbs96/ioBroker-twinkly/)


## twinkly adapter for ioBroker

Adapter to communicate with the [Twinkly lights](https://www.twinkly.com/).

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## Settings
The following Settings are available:
![admin.png](img/admin.png)

In the table you can add all the Twinkly lights you want to control. 

| Column       | Description                                                    |
|--------------|----------------------------------------------------------------|
| `Enabled`    | Shall this connection be accessed                              |
| `Name`       | Name of the connection in ioBroker                             |
| `IP Address` | IP-Address to the Twinkly Lights                               |
| `State On`   | Which `ledMode` should be activated when state `on` is enabled |

The following additionals States are created per device when checked:
* Device Info
* Network Status
* MQTT


The following States are available:

| State         | Writable           | Description                                                                                                                     |
|---------------|--------------------|---------------------------------------------------------------------------------------------------------------------------------|
| `connected`   | :x:                | Device Connected                                                                                                                |
| `details`     | :x:                | Device Details                                                                                                                  |
| `firmware`    | :x:                | Firmware Version                                                                                                                |
| `ledBri`      | :heavy_check_mark: | Brightness (deactivate control with -1)                                                                                         |
| `ledColor`    | :heavy_check_mark: | Color of LEDs, HSV/RGB(W)/HEX (`Color`)                                                                                         |
| `ledConfig`   | :heavy_check_mark: | Configuration of LEDs                                                                                                           |
| `ledEffect`   | :heavy_check_mark: | Effects (`Effect`)                                                                                                              |
| `ledLayout`   | :heavy_check_mark: | Layout of LEDs (disabled for further testing)                                                                                   |
| `ledMode`     | :heavy_check_mark: | Mode: Movie, Color, Effect, Playlist, Off, RealTime (not yet supported), Demo                                                   |
| `ledMovie`    | :heavy_check_mark: | Active Movie, If multiple Movies are added in the Playlist feature then they can be selected here. (`Movie`)                    |
| `ledPlaylist` | :heavy_check_mark: | Active Playlist Entry, Switch between Movies. (`Playlist`)                                                                      |
| `ledSat`      | :heavy_check_mark: | Saturation 0-100 (deactivate control with -1)                                                                                   |
| `mqtt`        | :heavy_check_mark: | MQTT-Connection                                                                                                                 |
| `name`        | :heavy_check_mark: | Name                                                                                                                            |
| `network`     | :x:                | Network-Information                                                                                                             |
| `on`          | :heavy_check_mark: | On/Off Switch                                                                                                                   |
| `paused`      | :heavy_check_mark: | Pause Connection to Twinkly so you can do changes in the App. Otherwise you might loose the connection while working in the App |
| `timer`       | :heavy_check_mark: | Update the Timer                                                                                                                |



[Private API information](https://xled-docs.readthedocs.io/en/latest/) by [Pavol Babinčák](https://github.com/scrool)


## Known Issues
* The maximum length for the movie name is 15 characters


## Changelog
<!--
  Placeholder for the next version (at the beginning of the line):
  ### **WORK IN PROGRESS**
-->
### 1.0.3 (2022-07-31)
* Add Online-Status to object-view
* Ignore `*.uid` values, unknown in which release they are available (IOBROKER-TWINKLY-1Q)

### 1.0.2 (2022-07-07)
* Add new values `details.uid` and `details.group.uid` fw >= 2.8.4, fwFamily=G (IOBROKER-TWINKLY-1G, IOBROKER-TWINKLY-1N)

### 1.0.1 (2022-07-05)
* Remove deprecated values from mode

### 1.0.0 (2022-07-03)
* Change refresh logic after State-Change
* Added depcrecated logic to remove states when no longer filled with data from api
* Check new and deprecated values from api response to update state information

### 0.3.1 (2022-07-02)
* Update translations logic i18n

### 0.3.0 (2022-07-01)
* Enable last used Mode on switch-on

### 0.2.14 (2022-07-01)
* Add new Value `network.station.monitorEnabled` from API-Response (Sentry IOBROKER-TWINKLY-13)
* Add new Value `network.station.connected_bssid` from API-Response (Sentry IOBROKER-TWINKLY-14)
* Add new Value `details.maxMovies` from API-Response (Sentry IOBROKER-TWINKLY-18)

## License
MIT License

Copyright (c) 2022 patrickbs96 <patrickbsimon96@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
