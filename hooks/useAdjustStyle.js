import { isBrowser } from '@/lib/utils';
import { runWhenIdle } from '@/lib/utils/clientIdle';
import { useEffect } from 'react';

/**
 * 样式调整的补丁
 */
const useAdjustStyle = () => {
  /**
   * 避免 callout 含有图片时溢出撑开父容器
   */
  const adjustCalloutImg = () => {
    const callOuts = document.querySelectorAll('.notion-callout-text');
    callOuts.forEach((callout) => {
      const images = callout.querySelectorAll('figure.notion-asset-wrapper.notion-asset-wrapper-image > div');
      const calloutWidth = callout.offsetWidth;
      images.forEach((container) => {
        const imageWidth = container.offsetWidth;
        if (imageWidth + 50 > calloutWidth) {
          container.style.setProperty('width', '100%');
        }
      });
    });
  };

  useEffect(() => {
    if (isBrowser) {
      let removeResizeListener;
      const cancelIdle = runWhenIdle(() => {
        adjustCalloutImg();
        window.addEventListener('resize', adjustCalloutImg);
        removeResizeListener = () =>
          window.removeEventListener('resize', adjustCalloutImg);
      }, 1200);

      return () => {
        cancelIdle?.();
        removeResizeListener?.();
      };
    }
  }, []);
};

export default useAdjustStyle;
