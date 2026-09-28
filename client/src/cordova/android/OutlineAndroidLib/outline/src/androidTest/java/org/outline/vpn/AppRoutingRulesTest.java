// Copyright 2026 The Outline Authors
// SPDX-License-Identifier: Apache-2.0

package org.outline.vpn;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.PackageManager;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.outline.TunnelConfig;

@RunWith(AndroidJUnit4.class)
public class AppRoutingRulesTest {
  private final Context context = ApplicationProvider.getApplicationContext();

  @Before
  @After
  public void clearTestPreferences() {
    context.getSharedPreferences("app_routing", Context.MODE_PRIVATE).edit().clear().commit();
  }

  @Test
  public void legacyPreferencesAndIndependentSelectionsSurviveModeChanges() {
    context.getSharedPreferences("app_routing", Context.MODE_PRIVATE).edit()
        .putBoolean("defaults_initialized", true)
        .putStringSet("bypassed_packages", Set.of("old.app")).commit();
    assertFalse(AppRoutingPreferences.isVpnOnly(context));
    assertEquals(Set.of("old.app"), AppRoutingPreferences.getSelectedPackages(context, false));
    AppRoutingPreferences.setVpnOnly(context, true);
    assertTrue(AppRoutingPreferences.getSelectedPackages(context, true).isEmpty());
    AppRoutingPreferences.setPackageSelected(context, true, "vpn.app", true);
    AppRoutingPreferences.setPackageSelected(context, true, context.getPackageName(), true);
    assertEquals(Set.of("vpn.app"), AppRoutingPreferences.getSelectedPackages(context, true));
    AppRoutingPreferences.setVpnOnly(context, false);
    assertEquals(Set.of("old.app"), AppRoutingPreferences.getSelectedPackages(context, false));
    AppRoutingPreferences.setVpnOnly(context, true);
    assertEquals(Set.of("vpn.app"), AppRoutingPreferences.getSelectedPackages(context, true));
    AppRoutingPreferences.setPackageSelected(context, true, "vpn.app", false);
    assertFalse(AppRoutingPreferences.hasInstalledVpnApps(context));
  }

  @Test
  public void bypassModeExcludesOwnAppAndNeverCallsAllow() throws Exception {
    TunnelConfig config = new TunnelConfig();
    config.disallowedApplications = new String[]{"direct.app", "own.app", "direct.app"};
    Set<String> bypassed = new HashSet<>();
    AppRoutingRules.apply(config, "own.app", p -> fail("mixed modes"), bypassed::add);
    assertEquals(Set.of("own.app", "direct.app"), bypassed);
  }

  @Test
  public void onlyModeIncludesSelectedAppsAndNeverCallsBypass() throws Exception {
    TunnelConfig config = new TunnelConfig();
    config.allowedApplications = new String[]{"vpn.app", "own.app", "vpn.app", "missing.app"};
    config.disallowedApplications = new String[]{"ignored.app"};
    Set<String> allowed = new HashSet<>();
    AppRoutingRules.apply(config, "own.app", p -> {
      if (p.equals("missing.app")) throw new PackageManager.NameNotFoundException();
      allowed.add(p);
    }, p -> fail("mixed modes"));
    assertEquals(Set.of("vpn.app"), allowed);
  }

  @Test
  public void emptyOrUninstalledAllowListNeverBecomesAllApps() throws Exception {
    for (String[] packages : new String[][]{new String[0], {"own.app"}, {"missing.app"}}) {
      TunnelConfig config = new TunnelConfig();
      config.allowedApplications = packages;
      assertThrows(IllegalArgumentException.class, () ->
          AppRoutingRules.apply(config, "own.app", p -> {
            throw new PackageManager.NameNotFoundException();
          }, p -> fail("must not fall back to bypass")));
    }
  }

  @Test
  public void persistedRulesRestoreModeIncludingEmptyAllowList() throws Exception {
    TunnelConfig legacy = new TunnelConfig();
    AppRoutingRules.read(new JSONObject("{\"disallowedApplications\":[\"direct.app\"]}"), legacy);
    assertNull(legacy.allowedApplications);
    assertArrayEquals(new String[]{"direct.app"}, legacy.disallowedApplications);
    for (String[] allowed : new String[][]{null, new String[0], {"vpn.app"}}) {
      TunnelConfig original = new TunnelConfig();
      original.allowedApplications = allowed;
      JSONObject stored = new JSONObject();
      AppRoutingRules.write(stored, original);
      TunnelConfig restored = new TunnelConfig();
      AppRoutingRules.read(new JSONObject(stored.toString()), restored);
      assertArrayEquals(allowed, restored.allowedApplications);
      assertTrue(AppRoutingRules.same(original, restored));
    }
    TunnelConfig only = new TunnelConfig();
    only.allowedApplications = new String[]{"vpn.app"};
    assertFalse(AppRoutingRules.same(legacy, only));
  }
}
