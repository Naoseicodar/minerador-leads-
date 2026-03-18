#!/bin/bash
# Inicia dashboard em background e bot como processo principal
node dashboard.js &
DASH_PID=$!

node zapchat.js

# Se o bot encerrar, mata o dashboard tambem
kill $DASH_PID 2>/dev/null
