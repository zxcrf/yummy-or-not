/* ============================================================
   YUMMY OR NOT — VideoPlayerModal (S3b Phase 2, native)
   Tap-to-play (D5) full-screen player for a taste video clip.

   - Opens over the card as a Modal; close returns to the card.
   - Plays a private R2 clip via a short-lived presigned GET URL (`clipUrl`).
   - ⟦D1⟧ On a playback error the presigned URL may have expired (pause-past-TTL).
     We re-fetch a FRESH taste (getTaste → fresh clipUrl) and retry ONCE; a
     second failure surfaces a non-blocking inline message.

   expo-video (useVideoPlayer / VideoView) is a NATIVE module — this only plays
   on device; the unit tests mock it. An EAS APK rebuild is required before
   device playback works (new native dep).
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { Modal, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useVideoPlayer, VideoView } from 'expo-video'
import { getTaste } from '@yon/shared'
import { Text, colors, space } from '@/theme'
import { Icon, IconButton } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'

interface Props {
  /** The taste id — used to re-fetch a fresh clipUrl on a playback error. */
  tasteId: string
  /** The initial presigned clip URL to play. */
  clipUrl: string
  /** Close the player and return to the card. */
  onClose: () => void
}

export function VideoPlayerModal({ tasteId, clipUrl, onClose }: Props) {
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  // The URL actually fed to the player. Starts at the passed-in clipUrl and is
  // swapped to a fresh presigned URL once on a playback error (TTL refresh).
  const [sourceUrl, setSourceUrl] = useState(clipUrl)
  const [loadError, setLoadError] = useState(false)
  // Guard so the on-error refresh runs at most once (retry once, then give up).
  const refreshedRef = useRef(false)

  const player = useVideoPlayer(sourceUrl, (p) => {
    p.play()
  })

  // ⟦D1⟧ Watch player status; on 'error' refresh the clipUrl once then retry.
  useEffect(() => {
    let alive = true
    const sub = player.addListener('statusChange', ({ status }) => {
      if (!alive) return
      if (status !== 'error') return
      if (refreshedRef.current) {
        // Already retried once — give up with a non-blocking message.
        setLoadError(true)
        return
      }
      refreshedRef.current = true
      void getTaste(tasteId)
        .then((fresh) => {
          if (!alive) return
          if (fresh.clipUrl) {
            // Feeding a new source URL re-creates the player source and retries.
            setSourceUrl(fresh.clipUrl)
          } else {
            setLoadError(true)
          }
        })
        .catch(() => {
          if (alive) setLoadError(true)
        })
    })
    return () => {
      alive = false
      sub.remove()
    }
  }, [player, tasteId])

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={onClose}
      testID="video-player-modal"
    >
      <View style={styles.backdrop}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls
          testID="video-player-view"
        />
        <View style={[styles.closeRow, { top: insets.top + space[2] }]}>
          <IconButton accessibilityLabel={t('cancel')} onPress={onClose}>
            <Icon name="close" size={20} color="#fff" />
          </IconButton>
        </View>
        {loadError ? (
          <View style={styles.errorBox} testID="video-player-error">
            <Text style={styles.errorText}>{t('video_load_failed')}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  closeRow: {
    position: 'absolute',
    right: space[4],
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  errorBox: {
    position: 'absolute',
    left: space[4],
    right: space[4],
    bottom: space[8],
    backgroundColor: colors.ink900,
    borderRadius: 12,
    padding: space[4],
  },
  errorText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
})

export default VideoPlayerModal
