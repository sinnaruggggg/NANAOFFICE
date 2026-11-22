#!/usr/bin/env bash
set -euo pipefail

trap 'if [ "$?" -ne 0 ]; then adb logcat -d -b crash -t 120; adb logcat -d -t 200 -s AndroidRuntime chromium; adb exec-out screencap -p > nana-mobile-error.png; fi' EXIT
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell wm size 720x1560
adb shell wm density 360
adb shell am start -W -n com.sinnaruggggg.nanaoffice/.MainActivity
adb exec-out screencap -p > nana-mobile-start.png
node android/smoke-ui.mjs
