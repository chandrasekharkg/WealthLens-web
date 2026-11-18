# Bridge API

## ADDED Requirements

### Requirement: Stopping the app stops its verbs, within a bound

When the bridge shuts down it SHALL stop accepting jobs, SHALL send SIGTERM to every verb subprocess it started,
and SHALL wait up to a configured grace (`WLW_STOP_GRACE`, default 15 seconds) before killing any that remain. No
verb the bridge started SHALL outlive it.

#### Scenario: The host halts during a rebuild
- **WHEN** the bridge receives SIGTERM while a rebuild it started is running
- **THEN** the rebuild is signalled and given the grace to stop, and the bridge exits only after it has

#### Scenario: A verb that will not stop
- **WHEN** a verb is still running when the grace expires
- **THEN** it is killed, and shutdown does not wait any longer
