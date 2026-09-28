// Copyright 2026 The Outline Authors
// SPDX-License-Identifier: Apache-2.0

package org.outline.vpn;

import android.content.pm.PackageManager;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.outline.TunnelConfig;

/** Applies one Android routing mode, never mixing allowed and disallowed lists. */
public final class AppRoutingRules {
  private AppRoutingRules() {}

  public interface AddPackage {
    void add(String packageName) throws PackageManager.NameNotFoundException;
  }

  public static void apply(TunnelConfig config, String ownPackage,
      AddPackage allow, AddPackage bypass) throws PackageManager.NameNotFoundException {
    boolean vpnOnly = config.allowedApplications != null;
    Set<String> packages = asSet(vpnOnly ? config.allowedApplications : config.disallowedApplications);
    packages.remove(ownPackage);
    if (!vpnOnly) packages.add(ownPackage);
    int applied = 0;
    for (String packageName : packages) {
      try {
        (vpnOnly ? allow : bypass).add(packageName);
        applied++;
      } catch (PackageManager.NameNotFoundException ignored) {
        // Persist stale selections: reinstalling restores the user's choice.
      }
    }
    if (vpnOnly && applied == 0) {
      // An empty Android allow list means ALL apps. Never fall back to that.
      throw new IllegalArgumentException("Select an installed app in VPN for applications");
    }
  }

  public static boolean same(TunnelConfig first, TunnelConfig second) {
    boolean only = first.allowedApplications != null;
    return only == (second.allowedApplications != null)
        && asSet(only ? first.allowedApplications : first.disallowedApplications).equals(
            asSet(only ? second.allowedApplications : second.disallowedApplications));
  }

  public static void write(JSONObject json, TunnelConfig config) throws JSONException {
    json.put("disallowedApplications", new JSONArray(asSet(config.disallowedApplications)));
    if (config.allowedApplications != null) {
      json.put("allowedApplications", new JSONArray(asSet(config.allowedApplications)));
    } else {
      json.remove("allowedApplications");
    }
  }

  public static void read(JSONObject json, TunnelConfig config) throws JSONException {
    config.disallowedApplications = readArray(json.optJSONArray("disallowedApplications"));
    config.allowedApplications = readArray(json.optJSONArray("allowedApplications"));
  }

  private static String[] readArray(JSONArray array) throws JSONException {
    if (array == null) return null;
    String[] packages = new String[array.length()];
    for (int i = 0; i < array.length(); i++) packages[i] = array.getString(i);
    return packages;
  }

  private static Set<String> asSet(String[] packages) {
    Set<String> result = new HashSet<>();
    if (packages != null) result.addAll(Arrays.asList(packages));
    result.remove(null);
    result.remove("");
    return result;
  }
}
