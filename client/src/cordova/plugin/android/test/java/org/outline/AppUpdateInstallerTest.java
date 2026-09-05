// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package org.outline;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.MotionEvent;
import android.view.InputDevice;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/**
 * Platform-only release smoke runner. No references to app/AndroidX/Kotlin
 * methods that R8 can rename or remove. Sign this separate androidTest APK
 * with the app signer to test the actual minified production APK.
 */
public class AppUpdateInstallerTest extends Instrumentation {
  private Bundle arguments;
  private int passed;

  @Override public void onCreate(Bundle arguments) {
    this.arguments = arguments == null ? new Bundle() : arguments;
    start();
  }

  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      testProviders();
      testReadableUri();
      testConfinement();
      if (arguments.getString("updateApkPath") != null) testVisibleButton();
      result.putString("stream", "\nOK (" + passed + " tests)\n");
      finish(Activity.RESULT_OK, result);
    } catch (Throwable error) {
      result.putString("stream", "\nFAIL after " + passed + " tests: " + error + "\n");
      finish(Activity.RESULT_CANCELED, result);
    }
  }

  private void require(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  private void pass(String name) {
    passed++;
    Bundle progress = new Bundle();
    progress.putString("stream", name + " — passed\n");
    sendStatus(0, progress);
  }

  private String authority() { return getTargetContext().getPackageName() + ".update.fileprovider"; }

  private Uri updateUri(String name) {
    return new Uri.Builder().scheme("content").authority(authority())
        .appendPath("app_updates").appendPath(name).build();
  }

  private File updateDirectory() {
    File directory = new File(getTargetContext().getCacheDir(), "updates");
    require(directory.isDirectory() || directory.mkdirs(), "Cannot create update directory");
    return directory;
  }

  private void testProviders() {
    PackageManager pm = getTargetContext().getPackageManager();
    ProviderInfo update = pm.resolveContentProvider(authority(), 0);
    ProviderInfo cordova = pm.resolveContentProvider(getTargetContext().getPackageName() + ".cdv.core.file.provider", 0);
    require(update != null && cordova != null, "Both providers must exist");
    require(!update.name.equals(cordova.name), "Provider component collision");
    require(!update.exported && update.grantUriPermissions, "Provider must require URI grants");
    pass("distinct private provider components");
  }

  private void testReadableUri() throws Exception {
    File probe = File.createTempFile("provider-probe-", ".apk", updateDirectory());
    byte[] payload = "update-provider-regression".getBytes(StandardCharsets.UTF_8);
    try {
      Files.write(probe.toPath(), payload);
      try (InputStream input = getTargetContext().getContentResolver().openInputStream(updateUri(probe.getName()))) {
        require(input != null, "No content stream");
        byte[] actual = new byte[payload.length];
        int offset = 0;
        while (offset < actual.length) {
          int count = input.read(actual, offset, actual.length - offset);
          require(count > 0, "Truncated content stream");
          offset += count;
        }
        require(Arrays.equals(payload, actual) && input.read() == -1, "Content differs");
      }
    } finally { Files.deleteIfExists(probe.toPath()); }
    pass("actual content URI round trip");
  }

  private void testConfinement() throws Exception {
    File privateFile = File.createTempFile("provider-private-", ".txt", getTargetContext().getCacheDir());
    try {
      try (InputStream ignored = getTargetContext().getContentResolver()
          .openInputStream(updateUri("../" + privateFile.getName()))) {
        throw new AssertionError("Parent-directory traversal must be rejected");
      } catch (SecurityException | IllegalArgumentException expected) {
        // Recipient cannot escape cache/updates.
      }
    } finally { Files.deleteIfExists(privateFile.toPath()); }
    pass("private cache confinement");
  }

  /** Only download state is seeded; the visible button and native code path are real. */
  private void testVisibleButton() throws Exception {
    File fixture = new File(updateDirectory(), "installer-acceptance.apk");
    Files.copy(new File(arguments.getString("updateApkPath")).toPath(), fixture.toPath(),
        StandardCopyOption.REPLACE_EXISTING);
    Intent installer = new Intent(Intent.ACTION_VIEW).setDataAndType(
        updateUri(fixture.getName()), "application/vnd.android.package-archive");
    ResolveInfo target = getTargetContext().getPackageManager().resolveActivity(installer, PackageManager.MATCH_DEFAULT_ONLY);
    require(target != null, "No Android package installer");
    Activity activity = startActivitySync(getTargetContext().getPackageManager()
        .getLaunchIntentForPackage(getTargetContext().getPackageName()));
    AtomicReference<WebView> web = new AtomicReference<>();
    runOnMainSync(() -> web.set(findWebView(activity.getWindow().getDecorView())));
    require(web.get() != null, "No WebView");
    long deadline = SystemClock.uptimeMillis() + 20000;
    while (SystemClock.uptimeMillis() < deadline &&
        !"true".equals(evaluate(web.get(), "Boolean(document.querySelector('app-root')?.$?.aboutView)"))) {
      SystemClock.sleep(100);
    }
    evaluate(web.get(), "document.querySelector('app-root').changePage('about')");
    deadline = SystemClock.uptimeMillis() + 25000;
    while (SystemClock.uptimeMillis() < deadline && "true".equals(evaluate(web.get(),
        "document.querySelector('app-root').$.aboutView.updateStatus === 'checking'"))) {
      SystemClock.sleep(100);
    }
    evaluate(web.get(), "(() => { const view = document.querySelector('app-root').$.aboutView;"
        + "view.downloadedUpdatePath = " + JSONObject.quote(fixture.getAbsolutePath()) + ";"
        + "view.updateStatus = 'installing'; view.requestUpdate(); })()");
    AccessibilityNodeInfo open = waitForText(getTargetContext().getPackageName(), "Открыть установщик", 10000);
    require(open != null, "Visible install button missing");
    Rect bounds = new Rect();
    open.getBoundsInScreen(bounds);
    long now = SystemClock.uptimeMillis();
    MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, bounds.centerX(), bounds.centerY(), 0);
    down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
    require(getUiAutomation().injectInputEvent(down, true), "Button touch failed");
    MotionEvent up = MotionEvent.obtain(now, now + 60, MotionEvent.ACTION_UP, bounds.centerX(), bounds.centerY(), 0);
    up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
    require(getUiAutomation().injectInputEvent(up, true), "Button release failed");
    down.recycle();
    up.recycle();
    require(waitForText(target.activityInfo.packageName, "(?i)(update|install|обновить|установить)", 20000) != null,
        "System installation confirmation did not remain open; status=" + evaluate(web.get(),
            "document.querySelector('app-root').$.aboutView.updateStatus"));
    // Leave confirmation open; replacing the target must happen after tests exit.
    pass("visible update button opens system confirmation");
  }

  private AccessibilityNodeInfo waitForText(String packageName, String pattern, long timeout) {
    long deadline = SystemClock.uptimeMillis() + timeout;
    do {
      AccessibilityNodeInfo found = findText(getUiAutomation().getRootInActiveWindow(), packageName, pattern);
      if (found != null) return found;
      SystemClock.sleep(100);
    } while (SystemClock.uptimeMillis() < deadline);
    return null;
  }

  private AccessibilityNodeInfo findText(AccessibilityNodeInfo node, String packageName, String pattern) {
    if (node == null) return null;
    if (packageName.contentEquals(node.getPackageName() == null ? "" : node.getPackageName())
        && node.getText() != null && node.getText().toString().matches(pattern)) return node;
    for (int i = 0; i < node.getChildCount(); i++) {
      AccessibilityNodeInfo found = findText(node.getChild(i), packageName, pattern);
      if (found != null) return found;
    }
    return null;
  }

  private WebView findWebView(View view) {
    if (view instanceof WebView) return (WebView) view;
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) {
        WebView found = findWebView(group.getChildAt(i));
        if (found != null) return found;
      }
    }
    return null;
  }

  private String evaluate(WebView webView, String script) throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    AtomicReference<String> result = new AtomicReference<>();
    runOnMainSync(() -> webView.evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
    require(done.await(5, TimeUnit.SECONDS), "WebView callback timed out");
    return result.get();
  }
}
