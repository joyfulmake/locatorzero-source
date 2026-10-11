# Security

LocatorZero's value rests on two promises: it sends nothing, and it keeps nothing. If you find a way to break
either, we want to know.

## Reporting

Email locatorzero.help@gmail.com with what you found, how to reproduce it, and the version.
Please give us 90 days to fix it before publishing. The licence explicitly allows good-faith security research
and publishing findings after that window (LICENSE, section 1b).

## In scope

- Any way the app or extension sends data off the device.
- Any way it writes, moves or deletes your files, or writes to browser databases.
- Anything that survives the 5-minute idle wipe in LocatorZero's own process.
- Reading another user's data through the open-tabs helper or its local socket.
- Bypassing licence-key verification by forging a key. (Resetting the trial clock is known and accepted.)

## Known limits, already documented

- The system webview keeps copies of typed text in memory after a search is cleared
  ([docs/measurements.md](docs/measurements.md), NFR-04).
- Installers are not code-signed yet.
