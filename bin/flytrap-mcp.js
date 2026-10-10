#!/usr/bin/env node
import {main} from '../src/index.js'

main().catch(error => {
    process.stderr.write(`flytrap-mcp: ${error?.message ?? error}\n`)
    process.exit(1)
})
