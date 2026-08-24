import { Card } from '@renderer/ui/components/card'
import { Icon } from '@renderer/ui/components/icon'

import { ViewHeader } from './view-header'

export function GenericView({ label }: { label: string }) {
  return (
    <div className="p-5">
      <ViewHeader crumbs={['prod-eu-west-1']} title={label} live />
      <Card className="grid h-64 place-items-center text-center">
        <div className="space-y-2 font-mono text-sm text-dim">
          <Icon name="layers" className="mx-auto h-8 w-8 text-faint" />
          <div>{label} view</div>
          <div className="text-xs text-faint">resource list renders here</div>
        </div>
      </Card>
    </div>
  )
}
