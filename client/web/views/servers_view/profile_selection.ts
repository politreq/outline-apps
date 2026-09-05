// Copyright 2026 The Outline Authors
// SPDX-License-Identifier: Apache-2.0

import {ServerConnectionState} from './server_connection_indicator';
import {ServerListItem} from './server_list_item';

export function hasActiveConnection(server: ServerListItem) {
  return [
    ServerConnectionState.CONNECTING,
    ServerConnectionState.CONNECTED,
    ServerConnectionState.RECONNECTING,
  ].includes(server.connectionState);
}

export function selectedProfile(servers: ServerListItem[], selectedId: string) {
  return (
    servers.find(server => server.id === selectedId) ??
    servers.find(hasActiveConnection) ??
    servers[0]
  );
}

// The door must always disconnect the running tunnel, even if the user has
// already selected another profile for the next connection.
export function activeProfile(servers: ServerListItem[], selectedId: string) {
  return (
    servers.find(hasActiveConnection) ?? selectedProfile(servers, selectedId)
  );
}
