Unveränderte Kopien aus `contracts/fixtures/monitor/` des Backend-main d9463ba (API 0.20.0). Platzhalter sind synthetisch.

# Monitor-Fixtures

`*.placeholder.json` sind ausdrücklich synthetische Schema-Beispiele, keine
Engine-Nachweise. `*.invalid.json` sind absichtlich ungültige Anfragen oder Antworten.
`MonitorRequest.basic.json` ist eine synthetische gültige Anfrage.
`MonitorResult.real-sqlite-*.json` stammen aus dem echten eingeschränkten SQLite-
Adapter über `scripts/test-monitor.py --sqlite-only`; keine Pfade oder Secrets.
Netzwerk-Fixtures fehlen bis zum tatsächlichen Lauf mit Docker über `scripts/dbfix.py`.
