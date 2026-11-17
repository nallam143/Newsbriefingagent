import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getBriefing, postBriefing, getTelegramStatus } from '../services/api';
import { CATEGORY_ORDER, categoryClass, categoryLabel } from '../services/categories';
import StoryThumbnail from '../components/StoryThumbnail';

function safeArticleUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
export default function BriefingDetail() {
  const { id } = useParams();
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState('');
  const [telegram, setTelegram] = useState(null);

  useEffect(() => {
    getBriefing(id)
      .then(setBriefing)
      .catch((err) => setMsg(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    getTelegramStatus().then(setTelegram).catch(() => setTelegram(null));
  }, [id]);

  const handlePost = async () => {
    if (posting) return;
    setPosting(true);
    setMsg('');
    try {
      const result = await postBriefing(id);
      setMsg(result.alreadyPosted ? '✅ This briefing was already sent to Telegram.' : `✅ Sent to Telegram${result.messages > 1 ? ` in ${result.messages} messages` : ''}.`);
      setBriefing((current) => ({ ...current, status: 'posted', posted_at: result.postedAt }));
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.error || err.message));
    } finally {
      setPosting(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!briefing) return <p>Briefing not found. <Link to="/">Back</Link></p>;

  let saved = {};
  try {
    saved = JSON.parse(briefing.content_json || '{}');
  } catch {
    // Older records may not contain valid structured content.
  }
  const sections = Array.isArray(saved.sections)
    ? saved.sections
        .filter((section) => Array.isArray(section?.stories) && section.stories.length > 0)
        .sort((left, right) => CATEGORY_ORDER.indexOf(categoryLabel(left.category)) - CATEGORY_ORDER.indexOf(categoryLabel(right.category)))
    : [];
  const incomplete = sections.length === 0;

  const statusLabel = incomplete ? 'Incomplete' : briefing.status === 'posted' ? 'Posted' : 'Draft ready';

  return (
    <div className="briefing-detail-page">
      <header className="detail-hero">
        <Link to="/" className="back-link">← Back to Dashboard</Link>
        <div className="detail-hero-copy">
          <p className="eyebrow">DAILY EDITION</p>
          <h1>{briefing.title}</h1>
          <p>{briefing.date} · {briefing.ai_provider} · <span className={`badge ${incomplete ? 'incomplete' : briefing.status}`}>{incomplete ? 'incomplete' : briefing.status}</span></p>
        </div>
      </header>

      {msg && <div className="notice" role="status" aria-live="polite">{msg}</div>}
      {telegram && !telegram.configured && briefing.status !== 'posted' && (
        <div className="notice telegram-notice" role="status">
          Telegram setup is needed. Set {telegram.missing.join(' and ')} in backend/.env, add your bot as a channel administrator with permission to post, and restart the backend.
        </div>
      )}

      <div className="detail-layout">
        <main className="detail-main">
          {!incomplete && (
            <nav className="topic-list detail-topic-list" aria-label="Briefing categories">
              {sections.map((section, index) => (
                <a className={`topic-pill category-${categoryClass(section.category)}`} href={`#category-${index}`} key={`${section.category}-${index}`}>
                  {categoryLabel(section.category)} <span>{section.stories.length}</span>
                </a>
              ))}
            </nav>
          )}

          {incomplete ? (
            <div className="card">This briefing was incomplete. Generate a new briefing from the Dashboard.</div>
          ) : (
            <article className="card briefing-content">
              {saved.summary && <p className="briefing-summary">{saved.summary}</p>}
              {sections.map((section, sectionIndex) => (
                <section className="briefing-section" id={`category-${sectionIndex}`} key={`${section.category || 'section'}-${sectionIndex}`}>
                  <h2>{categoryLabel(section.category)}</h2>
                  {(section.stories || []).map((story, storyIndex) => {
                    const sourceUrl = safeArticleUrl(story.url);
                    return (
                      <article className="briefing-story" key={`${story.headline || 'story'}-${storyIndex}`}>
                        <StoryThumbnail story={story} articles={briefing.articles} category={section.category} />
                        <div className="briefing-story-copy">
                          <span className={`story-category category-${categoryClass(section.category)}`}>{categoryLabel(section.category)}</span>
                          <h3>{story.headline || 'Untitled story'}</h3>
                          <p>{story.summary}</p>
                          {story.why_it_matters && <p className="why-it-matters"><strong>Why it matters:</strong> {story.why_it_matters}</p>}
                          {sourceUrl && (
                            <a className="briefing-source" href={sourceUrl} target="_blank" rel="noopener noreferrer">
                              {story.source || 'Read source'} ↗
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </section>
              ))}
            </article>
          )}

          {briefing.articles && briefing.articles.length > 0 && (
            <section className="source-articles">
              <h2>Source Articles</h2>
              {briefing.articles.map((article) => (
                <a key={article.id} className="source-article" href={article.url} target="_blank" rel="noreferrer">
                  <span><strong>{article.title}</strong><small>{article.source_name} · Rank #{article.rank}</small></span><span aria-hidden="true">↗</span>
                </a>
              ))}
            </section>
          )}
        </main>

        <aside className="detail-rail" aria-label="Telegram publishing">
          <section className="panel telegram-publishing detail-telegram">
            <div className="telegram-heading"><span className="telegram-plane" aria-hidden="true">➤</span><div><p className="eyebrow">PUBLISHING</p><h2>Telegram</h2></div></div>
            <div className="telegram-detail"><span>Draft status</span><strong>{statusLabel}</strong></div>
            <div className="telegram-detail"><span>Content</span><strong>{sections.reduce((total, section) => total + section.stories.length, 0)} stories</strong></div>
            <div className="telegram-detail"><span>Channel</span><strong>Telegram</strong></div>
            {briefing.status !== 'posted' && !incomplete && (
              <button className="telegram-send" onClick={handlePost} disabled={posting}>
                <span aria-hidden="true">➤</span>{posting ? 'Sending…' : 'Send to Telegram'}
              </button>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
