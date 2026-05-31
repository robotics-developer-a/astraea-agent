import React from 'react'
import { Box, Text } from 'ink'

// Astraea — 星之女神 / Goddess of Stars and Justice
//
// Character reference:
//   Greek origin: last immortal to leave Earth, became Virgo constellation
//   Personality: composed, dignified, just — serious but not cold
//   Aesthetic: star-priestess / mage, cool indigo palette, star crown
//
// Block element guide (Unicode quadrant blocks):
//   ▘=UL  ▝=UR  ▖=LL  ▗=LR
//   ▛=UL+UR+LL  ▜=UL+UR+LR  ▙=UL+LL+LR  ▟=UR+LL+LR
//
// Sprite layout (9 cols wide):
//   Row 0 [crown]:  ✦ ★ ✦  — silver star tiara
//   Row 1 [face]:   ▐⊙ · ⊙▌ — focused composed eyes, neutral mouth
//   Row 2 [robe]:   ▗▟█████▙▖ — flared robe/cape (wider hem than Clawd)
//   Row 3 [hem]:    ▘▝ · ▘▝  — robe ground line

const INDIGO = '#6A5ACD'  // slate-blue — dignified authority
const DEEP   = '#1A0F40'  // dark navy-purple — regal depth
const SILVER = '#C8D8FF'  // star-shimmer — magical accent
const EYE    = '#A0D4FF'  // cool sky-blue — focused gaze

export function AstraeaSprite(): React.ReactNode {
  return (
    <Box flexDirection="column" alignItems="center">
      {/* Star crown — ✦ flank a central ★ (star maiden identity) */}
      <Text color={SILVER}>{' ✦ ★ ✦ '}</Text>

      {/* Face — ⊙ = focused/alert eyes, · = composed neutral mouth */}
      <Text>
        <Text color={INDIGO}>{' ▐'}</Text>
        <Text color={EYE} backgroundColor={DEEP}>{'⊙ · ⊙'}</Text>
        <Text color={INDIGO}>{'▌ '}</Text>
      </Text>

      {/* Robe body — ▗▟ left + ▙▖ right creates a flared cape silhouette  */}
      {/* wider at hem than Clawd's ▝▜…▛▘, suggesting a flowing judicial robe */}
      <Text>
        <Text color={INDIGO}>{'▗▟'}</Text>
        <Text color={INDIGO} backgroundColor={DEEP}>{'█████'}</Text>
        <Text color={INDIGO}>{'▙▖'}</Text>
      </Text>

      {/* Robe hem line */}
      <Text color={INDIGO}>{'  ▘▝ ▘▝  '}</Text>
    </Box>
  )
}
