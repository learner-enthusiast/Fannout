'use client'

import { MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '~/components/ui/button'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '~/components/ui/tooltip'

/**
 * Sun/moon toggle between the two Fannout themes. Icons swap via the theme
 * class (CSS), so server and client markup match — no hydration flash.
 */
export function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme()

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Toggle theme"
                        onClick={() =>
                            setTheme(
                                resolvedTheme === 'light' ? 'dark' : 'light'
                            )
                        }
                    />
                }
            >
                <SunIcon aria-hidden className="light:hidden" />
                <MoonIcon aria-hidden className="hidden light:block" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle theme</TooltipContent>
        </Tooltip>
    )
}
