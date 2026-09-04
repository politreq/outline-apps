#!/usr/bin/env bash
# Copyright 2026 The Outline Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 APK_PATH RELEASE_NOTES BASELINE_APK" >&2
  exit 64
fi

apk_path=$1
release_notes=$2
baseline_apk=$3
update_server=${UPDATE_SERVER:-root@82.38.68.250}
remote_dir=/opt/outline-ws/site/v-domike
base_url=https://82.38.68.250.sslip.io/v-domike

if (( ${#release_notes} > 10000 )); then
  echo "Release notes must be 10000 characters or fewer" >&2
  exit 65
fi

for required_file in "$apk_path" "$baseline_apk"; do
  if [[ ! -f "$required_file" ]]; then
    echo "APK not found: $required_file" >&2
    exit 66
  fi
done

if [[ -z ${ANDROID_HOME:-} ]]; then
  echo "ANDROID_HOME is required" >&2
  exit 69
fi

build_tools_dir=$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)
aapt_bin="$build_tools_dir/aapt"
apksigner_bin="$build_tools_dir/apksigner"
for tool in "$aapt_bin" "$apksigner_bin" jq curl scp ssh shasum; do
  if [[ $tool == */* ]]; then
    [[ -x $tool ]] || { echo "Required tool not found: $tool" >&2; exit 69; }
  else
    command -v "$tool" >/dev/null || { echo "Required tool not found: $tool" >&2; exit 69; }
  fi
done

badging=$("$aapt_bin" dump badging "$apk_path" | sed -n '1p')
package_name=$(printf '%s\n' "$badging" | sed -n "s/.*package: name='\([^']*\)'.*/\1/p")
version_code=$(printf '%s\n' "$badging" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p")
version_name=$(printf '%s\n' "$badging" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p")

[[ $package_name == com.vdomike.vpn ]] || { echo "Unexpected package id" >&2; exit 65; }
[[ $version_code =~ ^[1-9][0-9]*$ ]] || { echo "Invalid versionCode" >&2; exit 65; }
[[ $version_name =~ ^[0-9A-Za-z._-]+$ ]] || { echo "Invalid versionName" >&2; exit 65; }

baseline_badging=$("$aapt_bin" dump badging "$baseline_apk" | sed -n '1p')
baseline_package=$(printf '%s\n' "$baseline_badging" | sed -n "s/.*package: name='\([^']*\)'.*/\1/p")
baseline_version_code=$(printf '%s\n' "$baseline_badging" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p")
[[ $baseline_package == "$package_name" ]] || { echo "Baseline package id differs" >&2; exit 65; }
[[ $baseline_version_code =~ ^[0-9]+$ && $version_code -gt $baseline_version_code ]] || {
  echo "Published versionCode must be greater than baseline" >&2
  exit 65
}

"$apksigner_bin" verify "$apk_path" >/dev/null
"$apksigner_bin" verify "$baseline_apk" >/dev/null
new_signer=$("$apksigner_bin" verify --print-certs "$apk_path" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1)
baseline_signer=$("$apksigner_bin" verify --print-certs "$baseline_apk" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1)
[[ -n $new_signer && $new_signer == "$baseline_signer" ]] || {
  echo "APK signing certificate does not match the baseline" >&2
  exit 65
}

current_manifest=$(mktemp "${TMPDIR:-/tmp}/v-domike-current.XXXXXX")
staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/v-domike-update.XXXXXX")
cleanup() {
  rm -f "$current_manifest"
  rm -rf "$staging_dir"
}
trap cleanup EXIT

if curl -fsS --connect-timeout 10 --max-time 30 "$base_url/latest.json" > "$current_manifest" &&
    jq -e '.packageName == "com.vdomike.vpn"' "$current_manifest" >/dev/null 2>&1; then
  current_version_code=$(jq -r '.versionCode' "$current_manifest")
  [[ $current_version_code == "$baseline_version_code" ]] || {
    echo "Public channel changed: expected baseline $baseline_version_code, found $current_version_code" >&2
    exit 65
  }
fi

apk_name="v-domike-${version_code}-${version_name}.apk"
staged_apk="$staging_dir/$apk_name"
staged_manifest="$staging_dir/latest.json"
cp "$apk_path" "$staged_apk"

sha256=$(shasum -a 256 "$staged_apk" | awk '{print $1}')
if stat -f '%z' "$staged_apk" >/dev/null 2>&1; then
  file_size=$(stat -f '%z' "$staged_apk")
else
  file_size=$(stat -c '%s' "$staged_apk")
fi
published_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

jq -n \
  --arg packageName "$package_name" \
  --arg versionName "$version_name" \
  --arg apkUrl "$base_url/$apk_name" \
  --arg sha256 "$sha256" \
  --arg publishedAt "$published_at" \
  --arg releaseNotes "$release_notes" \
  --argjson versionCode "$version_code" \
  --argjson fileSize "$file_size" \
  '{
    schemaVersion: 1,
    packageName: $packageName,
    versionCode: $versionCode,
    versionName: $versionName,
    apkUrl: $apkUrl,
    sha256: $sha256,
    fileSize: $fileSize,
    publishedAt: $publishedAt,
    releaseNotes: $releaseNotes
  }' > "$staged_manifest"

ssh "$update_server" "set -eu; install -d -m 0755 '$remote_dir'"
upload_tag="${version_code}-$$"
remote_apk_part="$remote_dir/.$apk_name.$upload_tag.part"
remote_manifest_part="$remote_dir/.latest.json.$upload_tag.part"

scp -q "$staged_apk" "$update_server:$remote_apk_part"
ssh "$update_server" \
  "set -eu; test \"\$(stat -c '%s' '$remote_apk_part')\" = '$file_size'; test \"\$(sha256sum '$remote_apk_part' | cut -d' ' -f1)\" = '$sha256'; if test -e '$remote_dir/$apk_name'; then test \"\$(stat -c '%s' '$remote_dir/$apk_name')\" = '$file_size'; test \"\$(sha256sum '$remote_dir/$apk_name' | cut -d' ' -f1)\" = '$sha256'; rm '$remote_apk_part'; else chmod 0644 '$remote_apk_part'; ln '$remote_apk_part' '$remote_dir/$apk_name'; rm '$remote_apk_part'; fi"

scp -q "$staged_manifest" "$update_server:$remote_manifest_part"
ssh "$update_server" \
  "set -eu; python3 -m json.tool '$remote_manifest_part' >/dev/null; chmod 0644 '$remote_manifest_part'; if test -f '$remote_dir/latest.json'; then cp '$remote_dir/latest.json' '$remote_dir/latest.json.previous'; fi; mv '$remote_manifest_part' '$remote_dir/latest.json'"

published_manifest=$(curl -fsS --retry 3 --retry-all-errors --connect-timeout 10 --max-time 180 "$base_url/latest.json")
printf '%s' "$published_manifest" | jq -e \
  --arg packageName "$package_name" \
  --arg versionName "$version_name" \
  --arg sha256 "$sha256" \
  --argjson versionCode "$version_code" \
  --argjson fileSize "$file_size" \
  '.packageName == $packageName and .versionCode == $versionCode and .versionName == $versionName and .sha256 == $sha256 and .fileSize == $fileSize' \
  >/dev/null

published_sha256=$(curl -fsS --retry 3 --retry-all-errors --connect-timeout 10 --max-time 180 "$base_url/$apk_name" | shasum -a 256 | awk '{print $1}')
[[ $published_sha256 == "$sha256" ]] || { echo "Published APK checksum mismatch" >&2; exit 65; }

echo "Published com.vdomike.vpn v$version_name ($version_code)"
echo "$base_url/latest.json"
