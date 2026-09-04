// Copyright 2026 The Outline Authors
// Licensed under the Apache License, Version 2.0.

import {isAndroidAppUpdateSupported, isUpdateAvailable} from './app_update';

describe('Android app update policy', () => {
  it('offers only a strictly newer versionCode', () => {
    expect(isUpdateAvailable(10001, 10100)).toBe(true);
    expect(isUpdateAvailable(10100, 10100)).toBe(false);
    expect(isUpdateAvailable(10100, 10001)).toBe(false);
  });

  it('is enabled only inside the Android Cordova client', () => {
    expect(
      isAndroidAppUpdateSupported({
        cordova: {platformId: 'android'},
      })
    ).toBe(true);
    expect(
      isAndroidAppUpdateSupported({
        cordova: {platformId: 'browser'},
      })
    ).toBe(false);
    expect(isAndroidAppUpdateSupported({})).toBe(false);
  });
});
