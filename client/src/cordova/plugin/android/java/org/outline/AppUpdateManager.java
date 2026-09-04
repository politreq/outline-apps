/*
  Copyright 2026 The Outline Authors
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
       http://www.apache.org/licenses/LICENSE-2.0
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

package org.outline;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONException;
import org.json.JSONObject;

/** Downloads and verifies app releases published in the self-hosted update channel. */
final class AppUpdateManager {
  private static final String MANIFEST_URL =
      "https://82.38.68.250.sslip.io/v-domike/latest.json";
  private static final String UPDATE_DIRECTORY = "updates";
  private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
  private static final int SUPPORTED_SCHEMA_VERSION = 1;
  private static final int HTTPS_PORT = 443;
  private static final int CONNECT_TIMEOUT_MS = 10_000;
  private static final int MANIFEST_TIMEOUT_MS = 15_000;
  private static final int APK_TIMEOUT_MS = 60_000;
  private static final int MAX_REDIRECTS = 3;
  private static final int MAX_MANIFEST_BYTES = 64 * 1024;
  private static final long MAX_APK_BYTES = 250L * 1024L * 1024L;
  private static final int BUFFER_SIZE = 64 * 1024;
  private static final Set<Integer> REDIRECT_CODES =
      new HashSet<>(Arrays.asList(301, 302, 303, 307, 308));

  private final Context context;
  private final URI manifestUri;

  AppUpdateManager(Context context) throws AppUpdateException {
    this.context = context.getApplicationContext();
    this.manifestUri = validateHttpsUri(MANIFEST_URL);
  }

  JSONObject checkForUpdate() throws AppUpdateException {
    AppRelease release = fetchLatestRelease();
    JSONObject response = release.toJson();
    try {
      response.put("available", release.versionCode > installedVersionCode());
      response.put("installedVersionCode", installedVersionCode());
      response.put("installedVersionName", installedVersionName());
      return response;
    } catch (JSONException e) {
      throw new AppUpdateException("invalid_manifest", e);
    }
  }

  JSONObject downloadLatestUpdate() throws AppUpdateException {
    AppRelease release = fetchLatestRelease();
    if (release.versionCode <= installedVersionCode()) {
      throw new AppUpdateException("up_to_date");
    }

    File updateDirectory = new File(context.getCacheDir(), UPDATE_DIRECTORY);
    if ((!updateDirectory.exists() && !updateDirectory.mkdirs()) || !updateDirectory.isDirectory()) {
      throw new AppUpdateException("storage");
    }

    File target = new File(updateDirectory, "v-domike-" + release.versionCode + ".apk");
    File partial = new File(updateDirectory, target.getName() + ".part");
    deleteQuietly(partial);

    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      HttpsURLConnection connection = openConnection(
          validateReleaseUri(release.apkUrl), APK_MIME_TYPE, APK_TIMEOUT_MS);
      try {
        ensureSuccessful(connection);
        long declaredLength = connection.getContentLengthLong();
        if (declaredLength > 0 && declaredLength != release.fileSize) {
          throw new AppUpdateException("download");
        }

        try (InputStream input = connection.getInputStream();
             FileOutputStream output = new FileOutputStream(partial)) {
          byte[] buffer = new byte[BUFFER_SIZE];
          long downloaded = 0;
          int count;
          while ((count = input.read(buffer)) != -1) {
            if (count == 0) {
              continue;
            }
            downloaded += count;
            if (downloaded > release.fileSize || downloaded > MAX_APK_BYTES) {
              throw new AppUpdateException("download");
            }
            output.write(buffer, 0, count);
            digest.update(buffer, 0, count);
          }
        }
      } finally {
        connection.disconnect();
      }

      if (partial.length() != release.fileSize) {
        throw new AppUpdateException("download");
      }
      if (!toHex(digest.digest()).equalsIgnoreCase(release.sha256)) {
        throw new AppUpdateException("checksum");
      }
      verifyArchive(partial, release.versionCode);

      if (target.exists() && !target.delete()) {
        throw new AppUpdateException("storage");
      }
      if (!partial.renameTo(target)) {
        throw new AppUpdateException("storage");
      }
      File[] cachedUpdates = updateDirectory.listFiles();
      if (cachedUpdates != null) {
        for (File cached : cachedUpdates) {
          if (!cached.equals(target) &&
              (cached.getName().endsWith(".apk") || cached.getName().endsWith(".part"))) {
            deleteQuietly(cached);
          }
        }
      }

      JSONObject response = release.toJson();
      response.put("filePath", target.getAbsolutePath());
      return response;
    } catch (AppUpdateException e) {
      deleteQuietly(partial);
      throw e;
    } catch (IOException e) {
      deleteQuietly(partial);
      throw new AppUpdateException("download", e);
    } catch (NoSuchAlgorithmException | JSONException e) {
      deleteQuietly(partial);
      throw new AppUpdateException("invalid_apk", e);
    }
  }

  JSONObject installDownloadedUpdate(String filePath) throws AppUpdateException {
    File updateDirectory = new File(context.getCacheDir(), UPDATE_DIRECTORY);
    final File apk;
    try {
      apk = new File(filePath).getCanonicalFile();
      String updateRoot = updateDirectory.getCanonicalPath() + File.separator;
      if (!apk.getPath().startsWith(updateRoot) || !apk.isFile() || !apk.getName().endsWith(".apk")) {
        throw new AppUpdateException("invalid_apk");
      }
    } catch (IOException e) {
      throw new AppUpdateException("invalid_apk", e);
    }

    verifyArchive(apk, -1);
    JSONObject response = new JSONObject();
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
          !context.getPackageManager().canRequestPackageInstalls()) {
        Intent settings = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + context.getPackageName()));
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(settings);
        response.put("status", "permission_required");
        return response;
      }

      Uri uri = FileProvider.getUriForFile(
          context, context.getPackageName() + ".update.fileprovider", apk);
      Intent installer = new Intent(Intent.ACTION_VIEW);
      installer.setDataAndType(uri, APK_MIME_TYPE);
      installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      installer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(installer);
      response.put("status", "installer_opened");
      return response;
    } catch (JSONException | RuntimeException e) {
      throw new AppUpdateException("installer", e);
    }
  }

  private AppRelease fetchLatestRelease() throws AppUpdateException {
    HttpsURLConnection connection = openConnection(manifestUri, "application/json", MANIFEST_TIMEOUT_MS);
    try {
      ensureSuccessful(connection);
      byte[] payload = readLimited(connection, MAX_MANIFEST_BYTES);
      return parseManifest(new String(payload, StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new AppUpdateException("network", e);
    } finally {
      connection.disconnect();
    }
  }

  private AppRelease parseManifest(String payload) throws AppUpdateException {
    try {
      JSONObject json = new JSONObject(payload);
      int schemaVersion = json.getInt("schemaVersion");
      String packageName = json.getString("packageName").trim();
      long versionCode = json.getLong("versionCode");
      String versionName = json.getString("versionName").trim();
      String apkUrl = json.getString("apkUrl").trim();
      String sha256 = json.getString("sha256").trim().toLowerCase(Locale.ROOT);
      long fileSize = json.getLong("fileSize");
      String publishedAt = json.getString("publishedAt").trim();
      String releaseNotes = json.optString("releaseNotes", "").trim();

      if (schemaVersion != SUPPORTED_SCHEMA_VERSION ||
          !context.getPackageName().equals(packageName) ||
          versionCode <= 0 ||
          versionName.isEmpty() || versionName.length() > 64 ||
          !sha256.matches("^[a-f0-9]{64}$") ||
          fileSize <= 0 || fileSize > MAX_APK_BYTES ||
          publishedAt.isEmpty() || publishedAt.length() > 64 ||
          releaseNotes.length() > 10_000) {
        throw new AppUpdateException("invalid_manifest");
      }
      validateReleaseUri(apkUrl);
      return new AppRelease(schemaVersion, packageName, versionCode, versionName, apkUrl,
          sha256, fileSize, publishedAt, releaseNotes);
    } catch (JSONException | IllegalArgumentException e) {
      throw new AppUpdateException("invalid_manifest", e);
    }
  }

  private void verifyArchive(File file, long expectedVersionCode) throws AppUpdateException {
    PackageManager packageManager = context.getPackageManager();
    PackageInfo archive = getArchiveInfo(packageManager, file);
    if (archive == null || !context.getPackageName().equals(archive.packageName)) {
      throw new AppUpdateException("invalid_apk");
    }
    long archiveVersion = archive.getLongVersionCode();
    if ((expectedVersionCode > 0 && archiveVersion != expectedVersionCode) ||
        archiveVersion <= installedVersionCode()) {
      throw new AppUpdateException("invalid_apk");
    }

    PackageInfo installed = getInstalledInfo(packageManager);
    if (installed.signingInfo == null || archive.signingInfo == null ||
        !sameSigners(installed.signingInfo.getApkContentsSigners(),
            archive.signingInfo.getApkContentsSigners())) {
      throw new AppUpdateException("signature");
    }
  }

  private PackageInfo getArchiveInfo(PackageManager packageManager, File file) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      return packageManager.getPackageArchiveInfo(
          file.getAbsolutePath(), PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES));
    }
    @SuppressWarnings("deprecation")
    PackageInfo info = packageManager.getPackageArchiveInfo(
        file.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
    return info;
  }

  private PackageInfo getInstalledInfo(PackageManager packageManager) throws AppUpdateException {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        return packageManager.getPackageInfo(
            context.getPackageName(), PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES));
      }
      @SuppressWarnings("deprecation")
      PackageInfo info = packageManager.getPackageInfo(
          context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
      return info;
    } catch (PackageManager.NameNotFoundException e) {
      throw new AppUpdateException("invalid_apk", e);
    }
  }

  private boolean sameSigners(Signature[] installed, Signature[] archive) {
    return installed != null && archive != null && installed.length > 0 &&
        new HashSet<>(Arrays.asList(installed)).equals(new HashSet<>(Arrays.asList(archive)));
  }

  private long installedVersionCode() throws AppUpdateException {
    return getInstalledInfo(context.getPackageManager()).getLongVersionCode();
  }

  private String installedVersionName() throws AppUpdateException {
    String versionName = getInstalledInfo(context.getPackageManager()).versionName;
    return versionName == null ? "" : versionName;
  }

  private HttpsURLConnection openConnection(URI initial, String accept, int timeoutMs)
      throws AppUpdateException {
    URI current = initial;
    for (int redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      try {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(current.toString()).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(timeoutMs);
        connection.setUseCaches(false);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", accept);
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Cache-Control", "no-cache");
        connection.setRequestProperty("User-Agent", "Vdomike/" + installedVersionName());
        int responseCode = connection.getResponseCode();
        if (!REDIRECT_CODES.contains(responseCode)) {
          return connection;
        }

        String location = connection.getHeaderField("Location");
        connection.disconnect();
        if (location == null || redirectCount == MAX_REDIRECTS) {
          throw new AppUpdateException("network");
        }
        current = validateReleaseUri(current.resolve(location).toString());
      } catch (IOException e) {
        throw new AppUpdateException("network", e);
      }
    }
    throw new AppUpdateException("network");
  }

  private void ensureSuccessful(HttpsURLConnection connection) throws IOException {
    if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
      throw new IOException("Unexpected HTTP status " + connection.getResponseCode());
    }
  }

  private byte[] readLimited(HttpsURLConnection connection, int limit)
      throws IOException, AppUpdateException {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    try (InputStream input = connection.getInputStream()) {
      byte[] buffer = new byte[4096];
      int total = 0;
      int count;
      while ((count = input.read(buffer)) != -1) {
        if (count == 0) {
          continue;
        }
        total += count;
        if (total > limit) {
          throw new AppUpdateException("invalid_manifest");
        }
        output.write(buffer, 0, count);
      }
    }
    return output.toByteArray();
  }

  private URI validateReleaseUri(String rawUrl) throws AppUpdateException {
    URI uri = validateHttpsUri(rawUrl);
    if (!manifestUri.getHost().equalsIgnoreCase(uri.getHost()) ||
        normalizedPort(manifestUri) != normalizedPort(uri)) {
      throw new AppUpdateException("invalid_manifest");
    }
    return uri;
  }

  private URI validateHttpsUri(String rawUrl) throws AppUpdateException {
    try {
      URI uri = new URI(rawUrl);
      if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
          uri.getUserInfo() != null || uri.getFragment() != null ||
          (uri.getPort() != -1 && uri.getPort() != HTTPS_PORT)) {
        throw new AppUpdateException("invalid_manifest");
      }
      return uri;
    } catch (URISyntaxException e) {
      throw new AppUpdateException("invalid_manifest", e);
    }
  }

  private int normalizedPort(URI uri) {
    return uri.getPort() == -1 ? HTTPS_PORT : uri.getPort();
  }

  private String toHex(byte[] bytes) {
    StringBuilder result = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) {
      result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
    }
    return result.toString();
  }

  private void deleteQuietly(File file) {
    if (file.exists()) {
      // Best effort only: stale cache files are never trusted without verification.
      file.delete();
    }
  }

  static final class AppUpdateException extends Exception {
    private final String code;

    AppUpdateException(String code) {
      super(code);
      this.code = code;
    }

    AppUpdateException(String code, Throwable cause) {
      super(code, cause);
      this.code = code;
    }

    JSONObject toJson() {
      JSONObject json = new JSONObject();
      try {
        json.put("code", code);
        json.put("message", "App update failed: " + code);
      } catch (JSONException ignored) {
        // The object only contains constant strings.
      }
      return json;
    }
  }

  private static final class AppRelease {
    final int schemaVersion;
    final String packageName;
    final long versionCode;
    final String versionName;
    final String apkUrl;
    final String sha256;
    final long fileSize;
    final String publishedAt;
    final String releaseNotes;

    AppRelease(int schemaVersion, String packageName, long versionCode, String versionName,
        String apkUrl, String sha256, long fileSize, String publishedAt, String releaseNotes) {
      this.schemaVersion = schemaVersion;
      this.packageName = packageName;
      this.versionCode = versionCode;
      this.versionName = versionName;
      this.apkUrl = apkUrl;
      this.sha256 = sha256;
      this.fileSize = fileSize;
      this.publishedAt = publishedAt;
      this.releaseNotes = releaseNotes;
    }

    JSONObject toJson() throws AppUpdateException {
      JSONObject json = new JSONObject();
      try {
        json.put("schemaVersion", schemaVersion);
        json.put("packageName", packageName);
        json.put("versionCode", versionCode);
        json.put("versionName", versionName);
        json.put("apkUrl", apkUrl);
        json.put("sha256", sha256);
        json.put("fileSize", fileSize);
        json.put("publishedAt", publishedAt);
        json.put("releaseNotes", releaseNotes);
        return json;
      } catch (JSONException e) {
        throw new AppUpdateException("invalid_manifest", e);
      }
    }
  }
}
