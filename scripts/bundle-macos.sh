#!/bin/sh
# Build a separate application; never replace /Applications/Lightship.app.
set -eu
cd "$(dirname "$0")/.."
profile="${LIGHTSHIP_BUILD_PROFILE:-release}"
cargo build --locked --profile "$profile"
target_dir="$(cargo metadata --offline --locked --format-version 1 --no-deps | python3 -c 'import json,sys;print(json.load(sys.stdin)["target_directory"])')"
binary_dir="$profile"
if [ "$profile" = dev ]; then binary_dir=debug; fi
bundle="$PWD/dist/Lightship GPUI.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources/licenses"
cp "$target_dir/$binary_dir/lightship" "$bundle/Contents/MacOS/lightship"
cp LICENSE "$bundle/Contents/Resources/licenses/Lightship-LICENSE"
cp licenses/JetBrainsMono-OFL.txt "$bundle/Contents/Resources/licenses/"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.pintle.lightship.gpui</string>
<key>CFBundleName</key><string>Lightship GPUI</string>
<key>CFBundleDisplayName</key><string>Lightship GPUI</string>
<key>CFBundleExecutable</key><string>lightship</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
codesign --force --sign - "$bundle"
printf '%s\n' "$bundle"
