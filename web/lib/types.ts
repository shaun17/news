export type Source = 'hn' | 'reddit' | 'x';

export interface Item {
  id: number;
  source: Source;
  source_id: string;
  title: string;
  body: string | null;
  post_url: string;
  link_url: string | null;
  author: string | null;
  sub_or_handle: string | null;
  score: number;
  comment_count: number | null;
  published_at: string;
}

export interface Topic {
  id: number;
  name: string;
  summary: string | null;
  item_count: number;
  source_count: number;
  total_score: number;
  is_hot: boolean;
  is_rising: boolean;
  last_active_at: string;
}

export interface TopicDetail extends Topic {
  key_entities: string[] | null;
  first_seen_at: string;
  items: Item[];
}
