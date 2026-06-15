import ActivityKit
import Foundation

// PUBLIC mirror of expo-live-activity's pod attributes (same name + shape), so
// the LifeOS App Intent (app target) can construct Activity<LiveActivityAttributes>
// that the widget renders. Overwrites node_modules/expo-live-activity/ios/
// LiveActivityAttributes.swift at prebuild via withPublicLiveActivityAttributes.js.
public struct LiveActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var title: String
    var subtitle: String?
    var timerEndDateInMilliseconds: Double?
    var progress: Double?
    var imageName: String?
    var dynamicIslandImageName: String?
    var smallImageName: String?
    var elapsedTimerStartDateInMilliseconds: Double?
    var currentStep: Int?
    var totalSteps: Int?

    public init(
      title: String,
      subtitle: String? = nil,
      timerEndDateInMilliseconds: Double? = nil,
      progress: Double? = nil,
      imageName: String? = nil,
      dynamicIslandImageName: String? = nil,
      smallImageName: String? = nil,
      elapsedTimerStartDateInMilliseconds: Double? = nil,
      currentStep: Int? = nil,
      totalSteps: Int? = nil
    ) {
      self.title = title
      self.subtitle = subtitle
      self.timerEndDateInMilliseconds = timerEndDateInMilliseconds
      self.progress = progress
      self.imageName = imageName
      self.dynamicIslandImageName = dynamicIslandImageName
      self.smallImageName = smallImageName
      self.elapsedTimerStartDateInMilliseconds = elapsedTimerStartDateInMilliseconds
      self.currentStep = currentStep
      self.totalSteps = totalSteps
    }
  }

  var name: String
  var backgroundColor: String?
  var titleColor: String?
  var subtitleColor: String?
  var progressViewTint: String?
  var progressViewLabelColor: String?
  var deepLinkUrl: String?
  var timerType: DynamicIslandTimerType?
  var padding: Int?
  var paddingDetails: PaddingDetails?
  var imagePosition: String?
  var imageWidth: Int?
  var imageHeight: Int?
  var imageWidthPercent: Double?
  var imageHeightPercent: Double?
  var smallImageWidth: Int?
  var smallImageHeight: Int?
  var smallImageWidthPercent: Double?
  var smallImageHeightPercent: Double?
  var imageAlign: String?
  var contentFit: String?
  var progressSegmentActiveColor: String?
  var progressSegmentInactiveColor: String?

  public init(
    name: String,
    backgroundColor: String? = nil,
    titleColor: String? = nil,
    subtitleColor: String? = nil,
    progressViewTint: String? = nil,
    progressViewLabelColor: String? = nil,
    deepLinkUrl: String? = nil,
    timerType: DynamicIslandTimerType? = nil,
    padding: Int? = nil,
    paddingDetails: PaddingDetails? = nil,
    imagePosition: String? = nil,
    imageWidth: Int? = nil,
    imageHeight: Int? = nil,
    imageWidthPercent: Double? = nil,
    imageHeightPercent: Double? = nil,
    smallImageWidth: Int? = nil,
    smallImageHeight: Int? = nil,
    smallImageWidthPercent: Double? = nil,
    smallImageHeightPercent: Double? = nil,
    imageAlign: String? = nil,
    contentFit: String? = nil,
    progressSegmentActiveColor: String? = nil,
    progressSegmentInactiveColor: String? = nil
  ) {
    self.name = name
    self.backgroundColor = backgroundColor
    self.titleColor = titleColor
    self.subtitleColor = subtitleColor
    self.progressViewTint = progressViewTint
    self.progressViewLabelColor = progressViewLabelColor
    self.deepLinkUrl = deepLinkUrl
    self.timerType = timerType
    self.padding = padding
    self.paddingDetails = paddingDetails
    self.imagePosition = imagePosition
    self.imageWidth = imageWidth
    self.imageHeight = imageHeight
    self.imageWidthPercent = imageWidthPercent
    self.imageHeightPercent = imageHeightPercent
    self.smallImageWidth = smallImageWidth
    self.smallImageHeight = smallImageHeight
    self.smallImageWidthPercent = smallImageWidthPercent
    self.smallImageHeightPercent = smallImageHeightPercent
    self.imageAlign = imageAlign
    self.contentFit = contentFit
    self.progressSegmentActiveColor = progressSegmentActiveColor
    self.progressSegmentInactiveColor = progressSegmentInactiveColor
  }

  public enum DynamicIslandTimerType: String, Codable {
    case circular
    case digital
  }

  public struct PaddingDetails: Codable, Hashable {
    var top: Int?
    var bottom: Int?
    var left: Int?
    var right: Int?
    var vertical: Int?
    var horizontal: Int?

    public init(
      top: Int? = nil,
      bottom: Int? = nil,
      left: Int? = nil,
      right: Int? = nil,
      vertical: Int? = nil,
      horizontal: Int? = nil
    ) {
      self.top = top
      self.bottom = bottom
      self.left = left
      self.right = right
      self.vertical = vertical
      self.horizontal = horizontal
    }
  }
}
