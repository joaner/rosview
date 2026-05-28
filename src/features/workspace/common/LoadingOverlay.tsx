import React from 'react';
import { useIntl } from 'react-intl';
import { Button } from '@/shared/ui/button';
import { Card, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card';
import { Spinner } from '@/shared/ui/spinner';

interface LoadingOverlayProps {
  sourceName?: string;
  onCancel?: () => void;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ sourceName, onCancel }) => {
  const { formatMessage } = useIntl();

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/50"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="rosview-loading-overlay"
    >
      <Card className="pointer-events-auto w-full max-w-sm border-border shadow-none">
        <CardHeader className="gap-2 pb-4 text-center">
          <Spinner className="mx-auto size-8 text-primary" aria-hidden />
          <CardTitle className="text-base font-semibold tracking-tight">
            {formatMessage({ id: 'welcome.loadingTitle' })}
          </CardTitle>
          {sourceName ? (
            <p className="truncate text-xs text-muted-foreground" title={sourceName}>
              {sourceName}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {formatMessage({ id: 'welcome.loadingPhase.preparing' })}
          </p>
        </CardHeader>
        {onCancel ? (
          <CardFooter className="justify-center pt-0">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              {formatMessage({ id: 'welcome.cancelLoading' })}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
};
