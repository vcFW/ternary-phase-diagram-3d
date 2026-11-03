import type { ReactNode } from 'react';
import { navigate, useRoute, type PageId } from '../app/router';

/** 分析页面的统一布局：左侧为本页章节（子路由，可深链接），右侧为内容。 */
export interface Section {
  id: string;
  title: string;
  sub?: string;
}

export function useSection(sections: Section[]): string {
  const r = useRoute();
  return sections.some((s) => s.id === r.sub) ? r.sub : sections[0].id;
}

export function AnalysisLayout({ page, sections, current, note, children }: { page: PageId; sections: Section[]; current: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="ap">
      <aside className="ap-side">
        <h3>本页章节</h3>
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#/${page}/${s.id}`}
            className={s.id === current ? 'on' : ''}
            onClick={(e) => {
              e.preventDefault();
              navigate(page, s.id);
            }}
          >
            {s.title}
            {s.sub && <small>{s.sub}</small>}
          </a>
        ))}
        {note && <div className="side-note">{note}</div>}
      </aside>
      <main className="ap-main" key={current}>
        {children}
      </main>
    </div>
  );
}

export function PageTitle({ title, desc }: { title: string; desc?: ReactNode }) {
  return (
    <div className="ap-title">
      <h2>{title}</h2>
      {desc && <p>{desc}</p>}
    </div>
  );
}
