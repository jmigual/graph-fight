// Nostr topic a build announces its lobby listings on (ADR 12). Only the deploy workflow opts in to
// the live topic; every other build, including a forgotten flag, gets the dev one, so test games
// never reach players on the live site.
export const LIVE_TOPIC = "graph-fight:lobby";
export const DEV_TOPIC = "graph-fight:lobby:dev";

export function lobbyTopic(env = process.env) {
  return env.GRAPH_FIGHT_LOBBY === "live" ? LIVE_TOPIC : DEV_TOPIC;
}
