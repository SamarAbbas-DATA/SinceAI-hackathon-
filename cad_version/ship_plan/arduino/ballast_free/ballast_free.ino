// Ballast-free trimaran: the MPU6050 measures the lean, the SG90 slides the battery sled to the high side.
// Board: Arduino Nano. Libraries: Wire and Servo (both come with the Arduino IDE, nothing to install).
//
// Wiring:  MPU6050 VCC -> 5V, GND -> GND, SDA -> A4, SCL -> A5   (MPU6050 X arrow pointing to the bow)
//          Servo orange -> D9, red -> battery +, brown -> GND
//          Battery + -> VIN, battery - -> GND
//          Jumper D2 -> GND = servo stays in the middle (use it to fit the horn, and for "servo off" tests)
//
// Open Tools > Serial Plotter (115200 baud) to see the lean and the servo angle live.

#include <Wire.h>
#include <Servo.h>

// ---------- settings you may change ----------
int   SERVO_CENTER = 90;      // arm points straight back at this angle. Adjust a few degrees if it does not.
int   DIRECTION    = 1;       // if the sled slides to the LOW side when you tilt the boat, change to -1
const float GAIN   = 6.0;     // servo degrees per degree of lean
const float DEADBAND = 0.5;   // leans smaller than this (degrees) are ignored
// ---------- do not change below unless you know why ----------
const int   SERVO_PIN = 9;
const int   OFF_PIN = 2;
const int   SERVO_RANGE = 55; // more than this and the sled hits its end stops
const float MAX_STEP = 2.0;   // degrees per loop (50 loops a second): smooth, not jerky
const int   MPU = 0x68;

Servo servo;
float roll = 0, rollZero = 0, gyroOffset = 0, leanSlow = 0, servoPos;
unsigned long lastMicros;
int printCount = 0;

int16_t read16() {
  int16_t hi = Wire.read();
  int16_t lo = Wire.read();
  return (hi << 8) | (lo & 0xFF);
}

bool readMPU(float &accRoll, float &gyroX) {
  Wire.beginTransmission(MPU);
  Wire.write(0x3B);                          // first accelerometer register
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU, 14) != 14) return false;
  int16_t ax = read16(), ay = read16(), az = read16();
  read16();                                  // temperature (not used)
  int16_t gx = read16();
  read16(); read16();                        // gyro y, z (not used)
  accRoll = atan2((float)ay, (float)az) * 180.0 / PI;   // lean from gravity, degrees
  gyroX = gx / 131.0;                                    // turning speed, degrees per second
  (void)ax;
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(OFF_PIN, INPUT_PULLUP);
  servoPos = SERVO_CENTER;
  servo.attach(SERVO_PIN);
  servo.write(SERVO_CENTER);

  Wire.begin();
  Wire.beginTransmission(MPU);
  Wire.write(0x6B); Wire.write(0);           // wake the MPU6050 up
  if (Wire.endTransmission() != 0) {
    while (true) {                           // no sensor: say so, keep the servo centred
      Serial.println("MPU6050 not found: check VCC->5V, GND->GND, SDA->A4, SCL->A5");
      delay(1000);
    }
  }
  Wire.beginTransmission(MPU);
  Wire.write(0x1A); Wire.write(3);           // built-in smoothing filter (about 44 Hz)
  Wire.endTransmission();

  // keep the boat still and level for 2 seconds: this sets "zero lean" and the gyro offset
  delay(1000);
  float sumRoll = 0, sumGyro = 0, a, g;
  int n = 0;
  for (int i = 0; i < 200; i++) {
    if (readMPU(a, g)) { sumRoll += a; sumGyro += g; n++; }
    delay(5);
  }
  if (n > 0) { rollZero = sumRoll / n; gyroOffset = sumGyro / n; }
  roll = rollZero;
  lastMicros = micros();
  Serial.println("ready");
}

void loop() {
  float accRoll, gyroX;
  if (readMPU(accRoll, gyroX)) {
    unsigned long now = micros();
    float dt = (now - lastMicros) / 1e6;
    lastMicros = now;
    // mix the fast gyro with the slow but drift-free accelerometer ("complementary filter")
    roll = 0.98 * (roll + (gyroX - gyroOffset) * dt) + 0.02 * accRoll;
  }
  float lean = roll - rollZero;                     // + = one side down, - = the other side down
  leanSlow += 0.05 * (lean - leanSlow);             // react to steady lean, not to every small wave

  float target = SERVO_CENTER;
  if (digitalRead(OFF_PIN) == HIGH) {               // no jumper on D2: mover is on
    float l = (fabs(leanSlow) < DEADBAND) ? 0 : leanSlow;
    target = SERVO_CENTER + DIRECTION * GAIN * l;
    target = constrain(target, SERVO_CENTER - SERVO_RANGE, SERVO_CENTER + SERVO_RANGE);
  }
  servoPos += constrain(target - servoPos, -MAX_STEP, MAX_STEP);
  servo.write((int)(servoPos + 0.5));

  if (++printCount >= 3) {                          // about 16 lines a second for the Serial Plotter
    printCount = 0;
    Serial.print("lean:");  Serial.print(lean, 2);
    Serial.print(",servo:"); Serial.println(servoPos - SERVO_CENTER, 1);
  }
  delay(20);
}
