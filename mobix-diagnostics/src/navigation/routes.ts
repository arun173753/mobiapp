export type RootStackParamList = {
  Home: undefined;
  DeviceInfo: undefined;
  AutoDiagnostics: undefined;
  ManualTests: undefined;
  Report: { reportId: string } | undefined;
  ReportsHistory: undefined;
  Settings: undefined;

  // Test screens
  TestMultiTouch: undefined;
  TestTouchGrid: undefined;
  TestDisplayColors: undefined;
  TestSpeaker: undefined;
  TestMicrophone: undefined;
  TestCamera: undefined;
  TestFlashlight: undefined;
  TestVibration: undefined;
  TestSensors: undefined;
  TestGPS: undefined;
  TestNetwork: undefined;
  TestBattery: undefined;
  TestCPUStress: undefined;
  TestStorage: undefined;
};

