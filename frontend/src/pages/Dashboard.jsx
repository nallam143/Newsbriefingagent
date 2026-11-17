import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getBriefings, getSources, runPipeline } from '../services/api';
import { CATEGORY_ORDER, categoryClass, categoryLabel, distinctSources, groupSources } from '../services/categories';
import { formatIndiaDateTime } from '../services/dateTime';
import StoryThumbnail from '../components/StoryThumbnail';

function readBriefing(row) {
  try {
    const content = JSON.parse(row.content_json || '{}');
    const sections = Array.isArray(content.sections)
      ? content.sections.filter((section) => Array.isArray(section?.stories) && section.stories.length > 0)
      : [];
    return { ...content, sections, storyCount: sections.reduce((count, section) => count + section.stories.length, 0) };
  } catch {
    return { sections: [], storyCount: 0 };
  }
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function scheduleLabel(scheduler) {
  if (!scheduler) return 'Schedule unavailable';
  if (!scheduler.enabled) return 'Schedule disabled';
  const match = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(scheduler.expression || '');
  if (!match) return `Cron ${scheduler.expression}`;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) return `Cron ${scheduler.expression}`;
  const timezone = ['Asia/Calcutta', 'Asia/Kolkata'].includes(scheduler.timezone)
    ? 'IST'
    : scheduler.timezone || 'server time';
  return `Daily ${String(hour % 12 || 12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'} ${timezone}`;
}

function PipelineIcon({ name }) {
  const props = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };

  if (name === 'pipeline') {
    return <svg {...props}><circle cx="5" cy="18" r="2.2" /><circle cx="12" cy="6" r="2.2" /><circle cx="19" cy="18" r="2.2" /><path d="m6.3 16 4.4-8" /><path d="m13.3 7.9 4.4 8" /></svg>;
  }
  if (name === 'collect') {
    return <svg {...props}><circle cx="5.4" cy="18.5" r="1.25" fill="currentColor" stroke="none" /><path d="M4.7 11.5a7 7 0 0 1 7.8 7.8" /><path d="M4.7 6.5a12 12 0 0 1 13 13" /></svg>;
  }
  if (name === 'filter') {
    return <svg {...props}><path d="M3 5h18l-7 8v5.1l-4 1.9V13L3 5Z" /></svg>;
  }
  if (name === 'analyze') {
    return <svg {...props}><circle cx="10.5" cy="11" r="5" /><path d="m14.3 14.8 4.5 4.5" /><path d="M18.5 4v3" /><path d="M17 5.5h3" /><path d="M4.5 4.7v2" /><path d="M3.5 5.7h2" /></svg>;
  }
  if (name === 'draft') {
    return <svg {...props}><path d="M6 3h9l3 3v9" /><path d="M15 3v4h4" /><path d="M6 8v12h7" /><path d="M9 12h4" /><path d="M9 15h2.5" /><path d="m13 19.5 5.8-5.8 2 2-5.8 5.8-2.7.7.7-2.7Z" /></svg>;
  }
  return <svg {...props}><path d="m21 3-7.3 18-3.5-7.2L3 10.3 21 3Z" /><path d="m10.2 13.8 4.1-4.1" /></svg>;
}

export default function Dashboard({ scheduler }) {
  const [briefings, setBriefings] = useState([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCategory = searchParams.get('category');

  const load = async () => {
    try {
      const [recent, feeds] = await Promise.all([getBriefings(15), getSources()]);
      setBriefings(recent);
      setSources(feeds);
    } catch (error) {
      setMessage(error.response?.data?.error || error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRun = async () => {
    setRunning(true);
    setMessage('Collecting feeds and generating a new draft. This may take a few minutes.');
    try {
      const result = await runPipeline({ autoPost: false });
      setMessage(result.success ? 'Briefing saved as a draft.' : result.message || 'No briefing was created.');
      await load();
    } catch (error) {
      setMessage(error.response?.data?.error || error.message);
    } finally {
      setRunning(false);
    }
  };

  const uniqueSources = distinctSources(sources);
  const activeSources = uniqueSources.filter((source) => source.is_active);
  const topics = groupSources(activeSources);
  const matching = briefings.filter((row) => !selectedCategory || readBriefing(row).sections.some((section) => categoryLabel(section.category) === selectedCategory));
  const latest = matching.find((row) => readBriefing(row).storyCount > 0);
  const latestData = latest ? readBriefing(latest) : null;
  const latestCategories = latestData
    ? [...new Set(latestData.sections.map((section) => categoryLabel(section.category)))].sort((left, right) => CATEGORY_ORDER.indexOf(left) - CATEGORY_ORDER.indexOf(right))
    : [];
  const currentCategory = selectedCategory && latestCategories.includes(selectedCategory) ? selectedCategory : latestCategories[0];
  const visibleStories = latestData?.sections
    .filter((section) => categoryLabel(section.category) === currentCategory)
    .flatMap((section) => section.stories) || [];
  const completedStages = latest ? (latest.status === 'posted' ? 5 : 4) : 0;
  const stages = [
    { label: 'Collect RSS', detail: `${activeSources.length} sources`, icon: 'collect' },
    { label: 'Filter & rank', detail: latest ? `${latestData.storyCount} stories kept` : 'Select the strongest stories', icon: 'filter' },
    { label: 'Analyze', detail: 'AI checks relevance', icon: 'analyze' },
    { label: 'Draft briefing', detail: latest ? 'Draft saved' : 'Create the daily brief', icon: 'draft' },
    { label: 'Deliver', detail: latest?.status === 'posted' ? 'Sent to Telegram' : 'Waiting for review', icon: 'deliver' },
  ];
  const pipelineProgress = Math.round((completedStages / stages.length) * 100);
  const pipelineNote = running
    ? 'Preparing today’s briefing…'
    : latest
      ? 'Last briefing is ready for review.'
      : 'Your first briefing will begin here.';
  const postedBriefing = briefings.find((row) => row.status === 'posted');
  const coverageColors = ['#796af5', '#2bd7b0', '#fb789e', '#8aa9ed', '#efb75f', '#4fc9dc'];
  const coverageRows = (latestData?.sections || []).map((section) => ({
    category: categoryLabel(section.category),
    count: section.stories.length,
  })).sort((left, right) => right.count - left.count);
  const coverageTotal = coverageRows.reduce((total, row) => total + row.count, 0);
  let coverageOffset = 0;
  const coverageStops = coverageRows.map((row, index) => {
    const start = coverageOffset;
    coverageOffset += (row.count / coverageTotal) * 100;
    return `${coverageColors[index % coverageColors.length]} ${start}% ${coverageOffset}%`;
  });
  const coverageGradient = coverageStops.length ? `conic-gradient(${coverageStops.join(', ')})` : 'conic-gradient(#30405f 0 100%)';

  return (
    <div className="dashboard-page">
      <div className="page-heading">
        <div className="home-masthead-copy">
          <h1 className="masthead-wordmark">News Pulse</h1>
          <p className="eyebrow">AUTONOMOUS NEWS BRIEFING</p>
          <p className="masthead-tagline">Finds, filters, and delivers the day’s most important news — automatically.</p>
        </div>
        <div className="hero-controls">
          <div className={`cron-badge ${scheduler?.enabled ? 'active' : ''}`} title={scheduler?.expression ? `Cron expression: ${scheduler.expression}` : undefined}>
            <span className="cron-indicator" aria-hidden="true" />
            <span>Cron job <strong className="cron-time">{scheduleLabel(scheduler)}</strong></span>
          </div>
          <div className="account-area">
            <button className="account-button" type="button" aria-label="User login" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20c.6-3.6 2.7-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /></svg>
            </button>
            {accountOpen && <div className="account-popover" role="status"><strong>User login</strong><p>Sign-in is not available yet.</p></div>}
          </div>
          <button className="primary-action" onClick={handleRun} disabled={running}>{running ? 'Running pipeline…' : '◉  Run Pipeline Now'}</button>
        </div>
      </div>

      {message && <div className="notice" role="status">{message}</div>}

      <div className="stats-grid">
        <div className="stat-card stat-sources"><span className="stat-label">SOURCES ACTIVE</span><strong>{activeSources.length}</strong><small>RSS feeds enabled</small></div>
        <div className="stat-card stat-categories"><span className="stat-label">CATEGORIES</span><strong>{topics.length}</strong><small>From active feeds</small></div>
        <div className="stat-card stat-stories"><span className="stat-label">STORIES KEPT</span><strong>{latestData?.storyCount ?? '—'}</strong><small>{latest ? 'Latest complete briefing' : 'No complete briefing yet'}</small></div>
        <div className="stat-card stat-delivery"><span className="stat-label">LATEST DELIVERY</span><strong className="delivery-value">{latest?.status === 'posted' ? 'Posted' : latest ? 'Draft' : '—'}</strong><small>{latest?.status === 'posted' ? 'Telegram' : 'Manual posting available'}</small></div>
      </div>

      <section className="panel pipeline-panel" aria-label="Briefing pipeline progress">
        <div className="pipeline-intro">
          <span className="pipeline-intro-icon" aria-hidden="true"><PipelineIcon name="pipeline" /></span>
          <div><h2>Briefing Pipeline</h2><p>{pipelineNote}</p></div>
        </div>
        <div className="pipeline-stage-list">
          {stages.map((stage, index) => (
            <div className={`pipeline-stage-card ${index < completedStages ? 'complete' : ''} ${running && index === completedStages ? 'current' : ''}`} key={stage.label}>
              {index < completedStages && <span className="pipeline-stage-status" aria-label="Complete">✓</span>}
              <span className="pipeline-stage-icon" aria-hidden="true"><PipelineIcon name={stage.icon} /></span>
              <strong>{stage.label}</strong>
              <small>{stage.detail}</small>
            </div>
          ))}
        </div>
        <div className="pipeline-progress" aria-label={`Pipeline progress: ${pipelineProgress}%`}>
          <span>Pipeline Progress</span>
          <strong>{pipelineProgress}%</strong>
          <div className="pipeline-progress-track"><span style={{ width: `${pipelineProgress}%` }} /></div>
        </div>
      </section>

      <div className="dashboard-grid">
      <section className="panel latest-panel">
        <div className="latest-header">
          <div>
            <p className="eyebrow">LATEST BRIEFING</p>
            <h2>{selectedCategory ? `${selectedCategory} briefing` : latest?.title || 'No briefing yet'}</h2>
            <p className="muted">{latest ? `${formatIndiaDateTime(latest.created_at)} · ${latest.ai_provider || 'AI'} · ${latestData.storyCount} stories` : 'Run the pipeline to create a briefing from your active feeds.'}</p>
          </div>
          {latest && <span className={`badge ${latest.status}`}>{latest.status}</span>}
        </div>

        {latest ? (
          <div className="latest-body">
            {latestCategories.length > 0 && (
              <div className="category-tabs" role="navigation" aria-label="Briefing categories">
                {latestCategories.map((category) => (
                  <button
                    type="button"
                    className={`category-tab category-${categoryClass(category)} ${currentCategory === category ? 'active' : ''}`}
                    key={category}
                    onClick={() => setSearchParams({ category })}
                  >{category}</button>
                ))}
                <button type="button" className="category-tab view-all" onClick={() => setSearchParams({})}>All topics</button>
              </div>
            )}
            {latestData.summary && <p className="latest-summary">{latestData.summary}</p>}
            <div className="story-list">
              {visibleStories.map((story, index) => {
                const url = safeUrl(story.url);
                return (
                  <article className="story-preview" key={`${story.headline}-${index}`}>
                    <StoryThumbnail story={story} articles={latest?.articles} category={currentCategory} />
                    <div className="story-preview-copy">
                      <span className={`story-category category-${categoryClass(currentCategory)}`}>{categoryLabel(currentCategory)}</span>
                      <h3>{story.headline || 'Untitled story'}</h3>
                      <p>{story.summary}</p>
                      <div className="story-meta">{story.source}{url && <> · <a href={url} target="_blank" rel="noopener noreferrer">Read source ↗</a></>}</div>
                    </div>
                  </article>
                );
              })}
            </div>
            <Link className="text-action" to={`/briefings/${latest.id}`}>Open full briefing →</Link>
          </div>
        ) : (
          <div className="empty-panel">{loading ? 'Loading briefings…' : selectedCategory ? `No ${selectedCategory} briefing has been generated yet.` : 'Your next generated briefing will appear here.'}</div>
        )}
      </section>

        <aside className="dashboard-rail" aria-label="Publishing and coverage">
          <section className="panel rail-panel telegram-publishing">
            <div className="telegram-heading"><span className="telegram-plane" aria-hidden="true">➤</span><div><p className="eyebrow">PUBLISHING</p><h2>Telegram</h2></div></div>
            <div className="telegram-detail"><span>Draft status</span><strong>{latest?.status === 'posted' ? 'Posted' : latest ? 'Ready for review' : 'Waiting'}</strong></div>
            <div className="telegram-detail"><span>Next delivery</span><strong>{scheduleLabel(scheduler)}</strong></div>
            {latest?.status === 'draft' && <Link className="channel-action" to={`/briefings/${latest.id}`}>Review Telegram draft <span aria-hidden="true">➤</span></Link>}
            {postedBriefing && <div className="recent-post"><strong>Latest Telegram post</strong><span>{postedBriefing.title || 'Briefing'} · {formatIndiaDateTime(postedBriefing.posted_at || postedBriefing.created_at)}</span></div>}
          </section>

          <section className="panel rail-panel">
            <h2>Coverage Mix</h2>
            {coverageTotal ? (
              <div className="coverage-content">
                <div className="coverage-donut" style={{ background: coverageGradient }}><span><strong>{coverageTotal}</strong><small>stories</small></span></div>
                <div className="coverage-legend">
                  {coverageRows.map((row, index) => <div key={row.category}><i style={{ background: coverageColors[index % coverageColors.length] }} />{row.category}<span>{Math.round((row.count / coverageTotal) * 100)}%</span></div>)}
                </div>
              </div>
            ) : <p className="rail-empty">Coverage appears after the first briefing.</p>}
          </section>

          <section className="panel rail-panel">
            <h2>Activity</h2>
            <div className="activity-row"><span />{activeSources.length} active RSS sources</div>
            <div className="activity-row"><span />{topics.length} categories from active feeds</div>
            <div className="activity-row"><span />{running ? 'Briefing pipeline running' : latest ? `Latest draft by ${latest.ai_provider || 'AI'}` : 'Awaiting first briefing'}</div>
          </section>
        </aside>
      </div>

      <section className="recent-section">
        <div className="section-heading"><h2>Recent Briefings</h2><Link to="/sources">Manage sources →</Link></div>
        <div className="panel recent-list">
          {loading ? <div className="empty-panel">Loading…</div> : matching.length === 0 ? (
            <div className="empty-panel">{selectedCategory ? `No briefings include ${selectedCategory} yet.` : 'No briefings yet.'}</div>
          ) : matching.slice(0, 8).map((row) => {
            const data = readBriefing(row);
            const labels = [...new Set(data.sections.map((section) => categoryLabel(section.category)))];
            return (
              <Link className="recent-row" to={`/briefings/${row.id}`} key={row.id}>
                <span className="recent-dot" />
                <span className="recent-main"><strong>{row.title || `Briefing ${row.date}`}</strong><small>{formatIndiaDateTime(row.created_at)} · {row.ai_provider || 'AI'}</small></span>
                <span className="recent-categories">{labels.slice(0, 3).join(' · ') || 'Incomplete'}</span>
                <span className={`badge ${data.storyCount ? row.status : 'incomplete'}`}>{data.storyCount ? `${data.storyCount} stories` : 'incomplete'}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

