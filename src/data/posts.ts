import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

export interface PostFrontmatter {
	title: string;
	description: string;
	pubDate: Date;
	updatedDate?: Date;
	tags: string[];
	stability: 'Observed in production' | 'Settled after iteration' | 'Proven in production';
	featured?: boolean;
}

export interface PostEntry {
	Content: AstroComponentFactory;
	slug: string;
	data: PostFrontmatter;
}

interface MarkdownModule {
	frontmatter: {
		title: string;
		description: string;
		pubDate: string;
		updatedDate?: string;
		tags?: string[];
		stability: PostFrontmatter['stability'];
		featured?: boolean;
	};
	default: AstroComponentFactory;
}

export function getPosts(): PostEntry[] {
	const modules = import.meta.glob('../content/posts/*.md', { eager: true }) as Record<
		string,
		MarkdownModule
	>;

	return Object.entries(modules)
		.map(([path, module]) => ({
			Content: module.default,
			slug: path.split('/').pop()?.replace(/\.md$/, '') ?? '',
			data: {
				title: module.frontmatter.title,
				description: module.frontmatter.description,
				pubDate: new Date(module.frontmatter.pubDate),
				updatedDate: module.frontmatter.updatedDate
					? new Date(module.frontmatter.updatedDate)
					: undefined,
				tags: module.frontmatter.tags ?? [],
				stability: module.frontmatter.stability,
				featured: module.frontmatter.featured ?? false,
			},
		}))
		.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}
