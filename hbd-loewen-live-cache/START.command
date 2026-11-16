#!/bin/bash
cd "$(dirname "$0")"
open "http://localhost:8080" >/dev/null 2>&1 &
exec npm run serve
