#!/usr/bin/env bash
set -euo pipefail

adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell wm size 720x1560
adb shell wm density 360
adb shell am start -W -n com.sinnaruggggg.nanaoffice/.MainActivity
adb exec-out screencap -p > nana-mobile-start.png
node android/smoke-ui.mjs
