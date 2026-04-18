import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="text-5xl font-bold tracking-tight text-muted-foreground">
        404
      </div>
      <div className="text-sm text-muted-foreground">
        That route does not exist.
      </div>
      <Button variant="outline" size="sm" onClick={() => navigate('/')}>
        Back home
      </Button>
    </div>
  )
}
