import type { ReactNode } from 'react';
import { Text } from '@fluentui/react-components';
import './PageHeader.css';

type PageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
  meta?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({
  title,
  description,
  eyebrow = 'Workspace',
  meta,
  actions,
}: PageHeaderProps) {
  return (
    <section className="pageHeader">
      <div className="pageHeader__body">
        <Text size={200} weight="semibold" className="pageHeader__eyebrow">
          {eyebrow}
        </Text>
        <Text as="h2" size={800} weight="bold" className="pageHeader__title">
          {title}
        </Text>
        <Text className="pageHeader__description">{description}</Text>
        {meta ? <div className="pageHeader__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="pageHeader__actions">{actions}</div> : null}
    </section>
  );
}
