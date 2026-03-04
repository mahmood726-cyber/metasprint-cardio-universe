import { ctgovConnector } from './ctgov.js';
import { aactConnector } from './aact.js';
import { pubmedConnector } from './pubmed.js';
import { openalexConnector } from './openalex.js';
import { europePmcConnector } from './europepmc.js';

const CONNECTORS = new Map([
  [ctgovConnector.id, ctgovConnector],
  [aactConnector.id, aactConnector],
  [pubmedConnector.id, pubmedConnector],
  [openalexConnector.id, openalexConnector],
  [europePmcConnector.id, europePmcConnector],
]);

export function getConnector(id) {
  return CONNECTORS.get(id) ?? null;
}

export function listConnectors() {
  return [...CONNECTORS.keys()];
}
