# Security policy

Please report a vulnerability **privately**, not as a public issue: *Security* → *Report a
vulnerability* in this repository (GitHub private vulnerability reporting). Include the addon
version, what is affected and how to reproduce it. You get an answer within a week; a fix is
published as a new release.

## Supported versions

Only the latest release.

## Scope

In scope: this addon - parsing of CSV exports and PDF statements, the activities it creates, the
settings it stores. Not in scope: Wealthfolio itself and its addon runtime (report to Wealthfolio).

## How the addon handles data

It makes **no network requests** (the manifest has no `network` permission): files are read and
parsed on the device. Its settings (accounts, transfer patterns, security mappings) are kept in
Wealthfolio's secret store through the addon API, not in plain files. It stores no passwords.
