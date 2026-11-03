import { getPosts, type PostEntry } from './posts';

export const homelabAgentOps = {
	slug: 'homelab-agent-ops',
	title: 'Homelab Agent Ops',
	description: 'Four field notes on giving an agent real operational work: changing infrastructure safely, repairing alerts, defining authority, and diagnosing across systems.',
} as const;

export function getHomelabAgentOpsPosts(): PostEntry[] {
	return getPosts()
		.filter((post) => post.data.series === homelabAgentOps.slug)
		.sort((a, b) => (a.data.seriesOrder ?? 0) - (b.data.seriesOrder ?? 0));
}
