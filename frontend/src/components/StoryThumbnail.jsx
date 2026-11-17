import { useState } from 'react';
import { categoryClass, categoryLabel } from '../services/categories';

export function storyImageUrl(story, articles = []) {
  return story?.image_url
    || articles.find((article) => article.url && article.url === story?.url)?.image_url
    || null;
}

export default function StoryThumbnail({ story, articles, category }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = storyImageUrl(story, articles);
  const label = categoryLabel(category);
  const className = `story-thumbnail category-${categoryClass(category)}${!imageUrl || failed ? ' is-fallback' : ''}`;

  return (
    <div className={className} data-category={label} aria-hidden={!imageUrl}>
      {imageUrl && !failed && <img src={imageUrl} alt="" onError={() => setFailed(true)} />}
      {(!imageUrl || failed) && <span>{label.slice(0, 1)}</span>}
    </div>
  );
}
