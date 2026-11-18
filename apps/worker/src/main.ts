import '../../api/src/config'
import { Exports } from '../../api/src/exports'
import { Monitoring } from '../../api/src/monitoring'
import { openStore } from '../../api/src/store'

const app = new Monitoring(await openStore())
app.startImports()
new Exports(app).start()
console.log('Worker impor dan laporan monitoring siap.')
setInterval(() => {}, 60_000)
