// Worker bootstrap: Node loads this .mjs natively, we register tsx's TS loader,
// then import the actual TypeScript worker. (Node won't load a .ts worker entry
// directly even with --import tsx, so we bootstrap through plain ESM.)
import { register } from 'tsx/esm/api'
register()
await import('./readworker.ts')
