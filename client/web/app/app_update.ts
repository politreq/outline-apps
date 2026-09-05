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

import {pluginExec, pluginExecWithProgress} from './plugin.cordova';

export interface AppRelease {
  schemaVersion: number;
  packageName: string;
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sha256: string;
  fileSize: number;
  publishedAt: string;
  releaseNotes: string;
}

export interface AppUpdateCheck extends AppRelease {
  available: boolean;
  installedVersionCode: number;
  installedVersionName: string;
}

export interface DownloadedAppUpdate extends AppRelease {
  filePath: string;
}

export interface AppUpdateDownloadProgress {
  type: 'progress';
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

export type AppUpdateInstallStatus =
  | 'permission_required'
  | 'installer_requested';

export type AppUpdateStage = 'check' | 'download' | 'install';

export function appUpdateErrorMessage(stage: AppUpdateStage): string {
  switch (stage) {
    case 'install':
      return 'Не удалось открыть установщик. Повторите попытку или установите APK из загрузок браузера.';
    case 'download':
      return 'Не удалось скачать или проверить обновление. Повторите загрузку.';
    default:
      return 'Не удалось проверить обновления. Проверьте подключение к интернету.';
  }
}

interface CordovaHost {
  cordova?: {platformId?: string};
}

export function isAndroidAppUpdateSupported(
  candidate: CordovaHost = window as unknown as CordovaHost
): boolean {
  return candidate.cordova?.platformId === 'android';
}

export function isUpdateAvailable(
  installedVersionCode: number,
  releaseVersionCode: number
): boolean {
  return releaseVersionCode > installedVersionCode;
}

export function isAppUpdateDownloadProgress(
  candidate: unknown
): candidate is AppUpdateDownloadProgress {
  if (!candidate || typeof candidate !== 'object') return false;
  const progress = candidate as Partial<AppUpdateDownloadProgress>;
  return (
    progress.type === 'progress' &&
    typeof progress.downloadedBytes === 'number' &&
    progress.downloadedBytes >= 0 &&
    typeof progress.totalBytes === 'number' &&
    progress.totalBytes > 0 &&
    progress.downloadedBytes <= progress.totalBytes &&
    typeof progress.percent === 'number' &&
    Number.isInteger(progress.percent) &&
    progress.percent >= 0 &&
    progress.percent <= 100
  );
}

export class AndroidAppUpdater {
  check(): Promise<AppUpdateCheck> {
    return pluginExec<AppUpdateCheck>('checkAppUpdate');
  }

  download(
    onProgress: (progress: AppUpdateDownloadProgress) => void = () => {}
  ): Promise<DownloadedAppUpdate> {
    return pluginExecWithProgress<
      DownloadedAppUpdate,
      AppUpdateDownloadProgress
    >('downloadAppUpdate', onProgress, isAppUpdateDownloadProgress);
  }

  install(filePath: string): Promise<{status: AppUpdateInstallStatus}> {
    return pluginExec<{status: AppUpdateInstallStatus}>(
      'installAppUpdate',
      filePath
    );
  }
}
