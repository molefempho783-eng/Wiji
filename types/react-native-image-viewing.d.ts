declare module "react-native-image-viewing" {
  import * as React from "react";
  import { ViewStyle, ImageSourcePropType } from "react-native";

  export interface ImageViewingProps {
    images: { uri: string }[];
    imageIndex?: number;
    visible: boolean;
    onRequestClose: () => void;
    onImageIndexChange?: (index: number) => void;
    swipeToCloseEnabled?: boolean;
    doubleTapToZoomEnabled?: boolean;
    animationType?: "fade" | "none" | "slide";
    backgroundColor?: string;
    FooterComponent?: React.ComponentType;
    renderImage?: (props: { source: { uri: string } }) => React.ReactNode;
  }

  const ImageViewing: React.FC<ImageViewingProps>;
  export default ImageViewing;
}
