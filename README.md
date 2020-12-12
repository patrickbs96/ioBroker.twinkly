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

## Settings
The following Settings are available:
![admin.png](img/admin.png)

In the table you can add all the Twinkly lights you want to control. 
`Connected State` is an additional feature here to check if the device is actually connected to the network or not. 
It can be used by adding a boolean State from e.g. the ping or tr-064 adapter. 

The following additionals States are created per device when checked:
* Device Info (read)
* MQTT (read/write)
* Timer (read/write)
* Reset (write)


## TODO
* Details, MQTT, Timer expand into multiple States
* Network-Status

## Changelog

### 0.0.3
* (patrickbs96) finalized Admin and Coding

### 0.0.1
* (patrickbs96) initial release

## License
MIT License

Copyright (c) 2020 patrickbs96 <patrickbsimon96@gmail.com>

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