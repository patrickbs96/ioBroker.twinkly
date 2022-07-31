# Older changes
## 0.2.13 (2022-07-01)
* Update dependencies

## 0.2.11 (2022-01-02)
* Add setting to select which ledMode should be activated

## 0.2.10 (2021-12-31)
* Add setting to enable automatically switching of Mode after State change (color, effect, movie, playlist)

## 0.2.8 (2021-12-20)
* Rename mode On to movie as it's a better representation

## 0.2.7 (2021-12-19)
* Hex without Hash. Option to not use ping for reachability.

## 0.2.6 (2021-12-09)
* Renamed States with led control. Now starting with "led".
* Add new State `ledLayout`/`ledPlaylist`

## 0.2.4 (2021-12-03)
* Handle wrong input so it does not cause exceptions
* Add new State `ledEffect`

## 0.2.2 (2021-11-30)
* Add new State `ledColor`

## 0.2.0 (2021-11-28)
* Add new Value `color` from API-Response (Sentry IOBROKER-TWINKLY-J, IOBROKER-TWINKLY-K, IOBROKER-TWINKLY-M, IOBROKER-TWINKLY-N, IOBROKER-TWINKLY-P)
* Add Pause-Feature, to work with app. (Twinkly only allows one active connection...)
* Add Feature, activate uploaded Movies (Playlist)

## 0.1.15 (2021-10-26)
* Add new Value `network.accesspoint.password_changed` from API-Response (Sentry IOBROKER-TWINKLY-A)

## 0.1.14 (2021-10-23)
* Add new Value `network.station.status` from API-Response (Sentry IOBROKER-TWINKLY-A, IOBROKER-TWINKLY-B)
* Add new Value `network.details.product_version` from API-Response (Sentry IOBROKER-TWINKLY-E)
* Add new Value `network.details.rssi` from API-Response (Sentry IOBROKER-TWINKLY-D)
* Add new Value `color` from API-Response (Sentry IOBROKER-TWINKLY-7)

## 0.1.13 (2021-10-13)
* Add new Value `network.station.rssi` from API-Response (Sentry IOBROKER-TWINKLY-8)

## 0.1.12 (2021-09-13)
* Added new Values from Response (Sentry IOBROKER-TWINKLY-7)
* Prevent excessive Sentry Logging

## 0.1.10 (2021-09-04)
* Update API values to Firmware 2.7.1

## 0.1.8 (2021-02-06)
* Changes from the Review

## 0.1.6
* Update dependencies

## 0.1.5
* Prevent Crash Case at HTTP Error (Sentry IOBROKER-TWINKLY-3)

## 0.1.4
* Temporary removing Reset as API path not exists

## 0.1.1
* Prevent Crash Case at HTTP Error (Sentry IOBROKER-TWINKLY-3)