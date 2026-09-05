// Copyright 2026 The Outline Authors
// SPDX-License-Identifier: Apache-2.0

package org.outline.vpn;

import static org.junit.Assert.*;

import android.content.res.Configuration;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowInsets;
import android.widget.ListView;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.outline.R;

@RunWith(AndroidJUnit4.class)
public class AppRoutingActivityTest {
  @Test
  public void warmHeaderRespectsSystemInsetsAndUsesRussian() {
    try (ActivityScenario<AppRoutingActivity> scenario =
        ActivityScenario.launch(AppRoutingActivity.class)) {
      waitForApps(scenario);
      scenario.onActivity(
          activity -> {
            View header = activity.findViewById(R.id.app_routing_header);
            View back = activity.findViewById(R.id.app_routing_back_button);
            TextView title = activity.findViewById(R.id.app_routing_title_text);
            int[] location = new int[2];
            header.getLocationOnScreen(location);
            WindowInsets insets = header.getRootWindowInsets();
            assertNotNull(insets);
            assertTrue(
                "Header must be below the status bar",
                location[1] >= insets.getSystemWindowInsetTop());
            assertEquals(
                "Title and back button must share the same vertical center",
                back.getY() + back.getHeight() / 2f,
                title.getY() + title.getHeight() / 2f,
                2f);
            assertEquals("VPN для приложений", title.getText().toString());
            assertEquals(
                Configuration.UI_MODE_NIGHT_NO,
                activity.getResources().getConfiguration().uiMode
                    & Configuration.UI_MODE_NIGHT_MASK);
            assertEquals(0xff4a2c1d, title.getCurrentTextColor());
          });
    }
  }

  @Test
  public void checkboxSavesAndShowsReconnectPopupOnlyAfterUserChanges() {
    try (ActivityScenario<AppRoutingActivity> scenario =
        ActivityScenario.launch(AppRoutingActivity.class)) {
      waitForApps(scenario);
      AtomicBoolean originallyChecked = new AtomicBoolean();
      final String[] packageName = new String[1];
      scenario.onActivity(
          activity -> {
            TextView popup = activity.findViewById(R.id.app_routing_reconnect_message);
            assertEquals(View.GONE, popup.getVisibility());
            ListView list = activity.findViewById(R.id.app_routing_list);
            // Bind a real row and dispatch the same click listener as a finger tap.
            View row = list.getAdapter().getView(0, null, list);
            android.widget.LinearLayout labels =
                (android.widget.LinearLayout) ((android.widget.LinearLayout) row).getChildAt(1);
            packageName[0] = ((TextView) labels.getChildAt(1)).getText().toString();
            originallyChecked.set(
                AppRoutingPreferences.getBypassedPackages(activity).contains(packageName[0]));
            row.performClick();
            assertEquals(
                !originallyChecked.get(),
                AppRoutingPreferences.getBypassedPackages(activity).contains(packageName[0]));
            assertEquals(View.VISIBLE, popup.getVisibility());
            assertEquals(
                activity.getString(R.string.app_routing_reconnect_popup),
                popup.getText().toString());
          });
      scenario.recreate();
      waitForApps(scenario);
      scenario.onActivity(
          activity -> {
            assertEquals(
                !originallyChecked.get(),
                AppRoutingPreferences.getBypassedPackages(activity).contains(packageName[0]));
            assertEquals(
                View.GONE,
                activity.findViewById(R.id.app_routing_reconnect_message).getVisibility());
            AppRoutingPreferences.setPackageBypassed(
                activity, packageName[0], originallyChecked.get());
          });
    }
  }

  private void waitForApps(ActivityScenario<AppRoutingActivity> scenario) {
    AtomicBoolean loaded = new AtomicBoolean();
    long deadline = SystemClock.uptimeMillis() + 15000;
    while (!loaded.get() && SystemClock.uptimeMillis() < deadline) {
      scenario.onActivity(
          activity -> {
            ListView list = activity.findViewById(R.id.app_routing_list);
            loaded.set(
                list.getAdapter() != null
                    && list.getAdapter().getCount() > 0
                    && list.getHeight() > 0);
          });
      if (!loaded.get()) SystemClock.sleep(50);
    }
    assertTrue("Installed apps must load", loaded.get());
  }
}
